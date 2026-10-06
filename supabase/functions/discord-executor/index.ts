import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { discordGet, ExecutorError } from './discord.ts';
import { planStructure, templateStructure, type Snapshot, type Strategy } from './planner.ts';

const cors = { 'Access-Control-Allow-Origin': 'https://nexium-store.vercel.app', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checked = <T extends { error: unknown }>(result: T): T => { if (result.error) throw new ExecutorError('DATABASE_ERROR', 500); return result; };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  // Readiness reveals only a boolean. Every data/operation endpoint verifies the user and admin role.
  if (req.method === 'GET' && new URL(req.url).searchParams.get('health') === '1') {
    return response({ version: 'scan-foundation-v1', discord_token_configured: !!Deno.env.get('DISCORD_BOT_TOKEN'), supported_actions: ['scan', 'preview', 'backup'] });
  }
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let jobId: string | undefined;
  let db: SupabaseClient | undefined;
  try {
    const url = Deno.env.get('SUPABASE_URL'); const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new ExecutorError('BACKEND_NOT_CONFIGURED', 503);
    const jwt = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!jwt) throw new ExecutorError('UNAUTHORIZED', 401);
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) throw new ExecutorError('UNAUTHORIZED', 401);
    const { data: profile } = checked(await db.from('profiles').select('role').eq('id', auth.user.id).single());
    if (profile?.role !== 'admin') throw new ExecutorError('FORBIDDEN', 403);
    const text = await req.text();
    if (text.length > 4096) throw new ExecutorError('PAYLOAD_TOO_LARGE', 413);
    let input; try { input = JSON.parse(text); } catch { throw new ExecutorError('INVALID_JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ExecutorError('INVALID_INPUT');
    const { action, config_id, idempotency_key, strategy = 'missing' } = input;
    if (!['scan', 'preview', 'backup'].includes(action)) throw new ExecutorError('ACTION_NOT_IMPLEMENTED', 409);
    if (typeof config_id !== 'string' || !uuid.test(config_id) || typeof idempotency_key !== 'string' || !uuid.test(idempotency_key)) throw new ExecutorError('INVALID_ID');
    if (!['reuse', 'missing', 'reorganize', 'rebuild'].includes(strategy)) throw new ExecutorError('INVALID_STRATEGY');
    const { data: config } = checked(await db.from('discord_builder_configs').select('*').eq('id', config_id).single());
    if (!config?.guild_id || !/^[0-9]{17,20}$/.test(config.guild_id)) throw new ExecutorError('GUILD_ID_REQUIRED');
    const { data: previous } = checked(await db.from('discord_jobs').select('*').eq('requested_by', auth.user.id).eq('idempotency_key', idempotency_key).maybeSingle());
    if (previous) {
      if (previous.config_id !== config_id || previous.action !== action || previous.input.strategy !== strategy) throw new ExecutorError('IDEMPOTENCY_CONFLICT', 409);
      return response({ job: previous });
    }
    // Read-only jobs abandoned by a terminated Edge runtime are marked failed after five minutes.
    checked(await db.from('discord_jobs').update({ status: 'failed', error_code: 'EXECUTION_EXPIRED', error_message: 'Execução interrompida; solicite um novo job.', finished_at: new Date().toISOString() })
      .eq('guild_id', config.guild_id).in('status', ['queued', 'running']).lt('created_at', new Date(Date.now() - 300000).toISOString()));
    const inserted = await db.from('discord_jobs').insert({ config_id, guild_id: config.guild_id, action, requested_by: auth.user.id, idempotency_key, input: { strategy } }).select('*').single();
    if (inserted.error?.code === '23505') throw new ExecutorError('GUILD_BUSY_OR_DUPLICATE_REQUEST', 409);
    const job = checked(inserted).data!; jobId = job.id;
    checked(await db.from('discord_jobs').update({ status: 'running', attempts: 1, started_at: new Date().toISOString() }).eq('id', jobId));
    checked(await db.from('discord_job_logs').insert({ job_id: jobId, level: 'info', code: 'STARTED', details: { action, strategy } }));
    let result: Record<string, unknown>;
    if (action === 'scan' || action === 'backup') {
      const token = Deno.env.get('DISCORD_BOT_TOKEN');
      if (!token) throw new ExecutorError('DISCORD_TOKEN_MISSING', 424);
      let peakAttempts = 1;
      const get = (path: string) => discordGet(path, token, async attempt => {
        peakAttempts = Math.max(peakAttempts, attempt);
        checked(await db!.from('discord_jobs').update({ attempts: peakAttempts }).eq('id', jobId));
        if (attempt > 1) checked(await db!.from('discord_job_logs').insert({ job_id: jobId, level: 'warning', code: 'DISCORD_RETRY', details: { path, attempt } }));
      });
      const guild = await get(`/guilds/${config.guild_id}`);
      const channels = await get(`/guilds/${config.guild_id}/channels`);
      const roles = await get(`/guilds/${config.guild_id}/roles`);
      const threads = await get(`/guilds/${config.guild_id}/threads/active`);
      const structure: Snapshot & { active_threads: unknown; captured_at: string } = { guild, channels, roles, active_threads: threads.threads || [], captured_at: new Date().toISOString() };
      const bytes = new TextEncoder().encode(JSON.stringify(structure));
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      const { data: snapshotId } = checked(await db.rpc('discord_save_scan', { p_job_id: jobId, p_structure: structure, p_checksum: checksum }));
      result = { snapshot_id: snapshotId, checksum, guild_name: guild.name, categories: channels.filter((c: { type: number }) => c.type === 4).length, channels: channels.filter((c: { type: number }) => c.type !== 4).length, roles: roles.length, active_threads: structure.active_threads, backup_scope: 'structure_only', archived_threads_included: false, messages_included: false };
    } else {
      const { data: snapshot } = checked(await db.from('discord_structure_snapshots').select('*').eq('guild_id', config.guild_id).order('created_at', { ascending: false }).limit(1).maybeSingle());
      if (!snapshot || Date.now() - Date.parse(snapshot.created_at) > 600000) throw new ExecutorError('FRESH_SCAN_REQUIRED', 409);
      const { data: mappings } = checked(await db.from('discord_resource_mappings').select('logical_key,discord_id,resource_type').eq('guild_id', config.guild_id).not('logical_key', 'is', null));
      const plan = planStructure(snapshot.structure, templateStructure(config), mappings || [], strategy as Strategy);
      // Preserve unambiguous logical bindings across later renames. Existing resources remain unowned.
      for (const operation of plan.operations) {
        if (operation.discord_id) checked(await db.from('discord_resource_mappings').update({ logical_key: operation.key }).eq('guild_id', config.guild_id).eq('discord_id', operation.discord_id));
      }
      // No apply handler exists yet. Do not let the UI interpret this preview as an executable job.
      result = { ...plan, executable: false, executor_pending: true, snapshot_id: snapshot.id, checksum: snapshot.checksum, config_updated_at: config.updated_at };
    }
    checked(await db.from('discord_job_logs').insert({ job_id: jobId, level: 'info', code: 'COMPLETED', details: { action } }));
    const { data: finished } = checked(await db.from('discord_jobs').update({ status: 'succeeded', result, finished_at: new Date().toISOString() }).eq('id', jobId).select('*').single());
    return response({ job: finished });
  } catch (error) {
    const safe = error instanceof ExecutorError ? error : new ExecutorError('INTERNAL_ERROR', 500);
    if (jobId && db) {
      const blocked = ['DISCORD_TOKEN_MISSING', 'DISCORD_TOKEN_INVALID', 'DISCORD_PERMISSION_DENIED', 'DISCORD_GUILD_OR_RESOURCE_NOT_FOUND', 'FRESH_SCAN_REQUIRED'].includes(safe.code);
      await db.from('discord_jobs').update({ status: blocked ? 'blocked' : 'failed', error_code: safe.code, error_message: safe.code, finished_at: new Date().toISOString() }).eq('id', jobId);
      await db.from('discord_job_logs').insert({ job_id: jobId, level: 'error', code: safe.code });
    }
    return response({ error: safe.code, job_id: jobId }, safe.httpStatus);
  }
});
