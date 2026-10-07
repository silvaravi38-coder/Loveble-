import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { discordGet, discordCreateMessage, discordUpdateMessage, ExecutorError } from './discord.ts';
import { planStructure, templateStructure, type Snapshot, type Strategy } from './planner.ts';
import { connectRuntime } from './runtime.ts';
import { describeBotAccess } from './permissions.ts';
import { requireCreatePlan, createPayload, discordCreate } from './apply.ts';
import { publishPanel } from '../discord-interactions/catalog.ts';

const cors = { 'Access-Control-Allow-Origin': 'https://nexium-store.vercel.app', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checked = <T extends { error: unknown }>(result: T): T => { if (result.error) throw new ExecutorError('DATABASE_ERROR', 500); return result; };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  // Readiness reveals only a boolean. Every data/operation endpoint verifies the user and admin role.
  if (req.method === 'GET' && new URL(req.url).searchParams.get('health') === '1') {
    return response({ version: 'create-executor-v1', discord_token_configured: !!Deno.env.get('DISCORD_BOT_TOKEN'), supported_actions: ['scan', 'preview', 'backup', 'apply'] });
  }
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let jobId: string | undefined;
  let db: SupabaseClient | undefined;
  try {
    const url = Deno.env.get('SUPABASE_URL'); const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new ExecutorError('BACKEND_NOT_CONFIGURED', 503);
    db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const text = await req.text();
    if (text.length > 4096) throw new ExecutorError('PAYLOAD_TOO_LARGE', 413);
    let input; try { input = JSON.parse(text); } catch { throw new ExecutorError('INVALID_JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ExecutorError('INVALID_INPUT');
    let actorId: string | undefined; let runtimeTarget: string | undefined;
    let config: Record<string, any>; let action: string; let strategy: Strategy; let expectedApplicationId: string | undefined; let previewJobId: string | undefined;
    const dispatch = req.headers.get('X-Nexium-Job-Capability');
    if (dispatch) {
      if (!/^[a-f0-9]{64}$/.test(dispatch) || !uuid.test(input.job_id || '')) throw new ExecutorError('UNAUTHORIZED', 401);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dispatch));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const claimed = checked(await db.rpc('discord_claim_dispatch', { p_job_id: input.job_id, p_token_hash: hash })).data;
      if (!claimed) throw new ExecutorError('UNAUTHORIZED', 401);
      jobId = claimed.id; actorId = claimed.requested_by; runtimeTarget = claimed.input.target; action = claimed.action; strategy = claimed.input.strategy || 'missing';
      expectedApplicationId = claimed.input.expected_application_id;
      previewJobId = claimed.input.preview_job_id;
      config = checked(await db.from('discord_builder_configs').select('*').eq('id', claimed.config_id).single()).data;
      if (config.guild_id !== claimed.guild_id) throw new ExecutorError('CONFIG_GUILD_CHANGED', 409);
      if (!['reuse', 'missing', 'reorganize', 'rebuild'].includes(strategy)) throw new ExecutorError('INVALID_STRATEGY');
    } else {
      const jwt = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if (!jwt) throw new ExecutorError('UNAUTHORIZED', 401);
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) throw new ExecutorError('UNAUTHORIZED', 401);
    const { data: profile } = checked(await db.from('profiles').select('role').eq('id', auth.user.id).single());
    if (profile?.role !== 'admin') throw new ExecutorError('FORBIDDEN', 403);
    const { config_id, idempotency_key } = input;
    action = input.action; strategy = input.strategy || 'missing';
    if (!['scan', 'preview', 'backup', 'apply'].includes(action)) throw new ExecutorError('ACTION_NOT_IMPLEMENTED', 409);
    previewJobId = input.preview_job_id;
    if (action === 'apply' && (typeof previewJobId !== 'string' || !uuid.test(previewJobId))) throw new ExecutorError('PREVIEW_REQUIRED', 409);
    if (typeof config_id !== 'string' || !uuid.test(config_id) || typeof idempotency_key !== 'string' || !uuid.test(idempotency_key)) throw new ExecutorError('INVALID_ID');
    if (!['reuse', 'missing', 'reorganize', 'rebuild'].includes(strategy)) throw new ExecutorError('INVALID_STRATEGY');
    config = checked(await db.from('discord_builder_configs').select('*').eq('id', config_id).single()).data;
    if (!config?.guild_id || !/^[0-9]{17,20}$/.test(config.guild_id)) throw new ExecutorError('GUILD_ID_REQUIRED');
    const { data: previous } = checked(await db.from('discord_jobs').select('*').eq('requested_by', auth.user.id).eq('idempotency_key', idempotency_key).maybeSingle());
    if (previous) {
      if (previous.config_id !== config_id || previous.action !== action || previous.input.strategy !== strategy || (action==='apply' && previous.input.preview_job_id !== previewJobId)) throw new ExecutorError('IDEMPOTENCY_CONFLICT', 409);
      return response({ job: previous });
    }
    // Read-only jobs abandoned by a terminated Edge runtime are marked failed after five minutes.
    checked(await db.from('discord_jobs').update({ status: 'failed', error_code: 'EXECUTION_EXPIRED', error_message: 'Execução interrompida; solicite um novo job.', finished_at: new Date().toISOString() })
      .eq('guild_id', config.guild_id).in('action', ['scan','preview','backup']).in('status', ['queued', 'running']).lt('created_at', new Date(Date.now() - 300000).toISOString()));
    const inserted = await db.from('discord_jobs').insert({ config_id, guild_id: config.guild_id, action, requested_by: auth.user.id, idempotency_key, input: { strategy, ...(previewJobId ? {preview_job_id:previewJobId}: {}) } }).select('*').single();
    if (inserted.error?.code === '23505') throw new ExecutorError('GUILD_BUSY_OR_DUPLICATE_REQUEST', 409);
    const job = checked(inserted).data!; jobId = job.id;
    checked(await db.from('discord_jobs').update({ status: 'running', attempts: 1, started_at: new Date().toISOString() }).eq('id', jobId));
    }
    checked(await db.from('discord_job_logs').insert({ job_id: jobId, level: 'info', code: 'STARTED', details: { action, strategy } }));
    let result: Record<string, unknown>;
    if (action === 'publish') {
      if (!actorId || runtimeTarget !== 'runtime_connection') throw new ExecutorError('ACTION_NOT_IMPLEMENTED',409);
      const token = Deno.env.get('DISCORD_BOT_TOKEN');
      if (!token) throw new ExecutorError('DISCORD_TOKEN_MISSING',424);
      result = await connectRuntime(db,config.guild_id,actorId,token);
    } else if (action === 'scan' || action === 'backup') {
      const token = Deno.env.get('DISCORD_BOT_TOKEN');
      if (!token) throw new ExecutorError('DISCORD_TOKEN_MISSING', 424);
      let peakAttempts = 1;
      const get = (path: string) => discordGet(path, token, async attempt => {
        peakAttempts = Math.max(peakAttempts, attempt);
        checked(await db!.from('discord_jobs').update({ attempts: peakAttempts }).eq('id', jobId));
        if (attempt > 1) checked(await db!.from('discord_job_logs').insert({ job_id: jobId, level: 'warning', code: 'DISCORD_RETRY', details: { path, attempt } }));
      });
      const bot = await get('/users/@me');
      if (!bot.bot || (expectedApplicationId && bot.id !== expectedApplicationId)) throw new ExecutorError('DISCORD_APPLICATION_MISMATCH', 424);
      const guild = await get(`/guilds/${config.guild_id}`);
      const channels = await get(`/guilds/${config.guild_id}/channels`);
      const roles = await get(`/guilds/${config.guild_id}/roles`);
      const botMember = await get(`/guilds/${config.guild_id}/members/${bot.id}`);
      const botAccess = describeBotAccess(config.guild_id, roles, botMember.roles || []);
      const threads = await get(`/guilds/${config.guild_id}/threads/active`);
      const structure: Snapshot & { active_threads: unknown; captured_at: string; bot_access: unknown; bot_role_ids: string[] } = { guild, channels, roles, bot_access: botAccess, bot_role_ids: botMember.roles || [], active_threads: threads.threads || [], captured_at: new Date().toISOString() };
      const bytes = new TextEncoder().encode(JSON.stringify(structure));
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      const { data: snapshotId } = checked(await db.rpc('discord_save_scan', { p_job_id: jobId, p_structure: structure, p_checksum: checksum }));
      result = { snapshot_id: snapshotId, checksum, bot_id: bot.id, bot_access: botAccess, guild_name: guild.name, categories: channels.filter((c: { type: number }) => c.type === 4).length, channels: channels.filter((c: { type: number }) => c.type !== 4).length, roles: roles.length, active_threads: structure.active_threads, backup_scope: 'structure_only', archived_threads_included: false, messages_included: false };
    } else if (action === 'apply') {
      if (!previewJobId || !uuid.test(previewJobId)) throw new ExecutorError('PREVIEW_REQUIRED',409);
      const preview = checked(await db.from('discord_jobs').select('*').eq('id',previewJobId).eq('config_id',config.id).eq('guild_id',config.guild_id).eq('action','preview').eq('status','succeeded').single()).data;
      const before = checked(await db.from('discord_structure_snapshots').select('*').eq('id',preview.result.snapshot_id).eq('guild_id',config.guild_id).single()).data;
      if (Date.now()-Date.parse(before.created_at)>600000) throw new ExecutorError('FRESH_SCAN_REQUIRED',409);
      const token = Deno.env.get('DISCORD_BOT_TOKEN'); if (!token) throw new ExecutorError('DISCORD_TOKEN_MISSING',424);
      const get = (path:string) => discordGet(path,token,async attempt => { if(attempt>1) checked(await db!.from('discord_job_logs').insert({job_id:jobId,level:'warning',code:'DISCORD_RETRY',details:{path,attempt}})); });
      const bot = await get('/users/@me');
      if (!bot.bot || (expectedApplicationId && bot.id !== expectedApplicationId)) throw new ExecutorError('DISCORD_APPLICATION_MISMATCH',424);
      const current:Snapshot = {guild:await get(`/guilds/${config.guild_id}`),channels:await get(`/guilds/${config.guild_id}/channels`),roles:await get(`/guilds/${config.guild_id}/roles`)};
      const member = await get(`/guilds/${config.guild_id}/members/${bot.id}`);
      const access = describeBotAccess(config.guild_id,current.roles,member.roles||[]);
      const {ids,operations} = requireCreatePlan(preview.result,config.updated_at,before.structure,current);
      if (operations.some(o=>o.kind==='role') && !access.manage_roles) throw new ExecutorError('DISCORD_PERMISSION_DENIED',424);
      if (operations.some(o=>o.kind!=='role') && !access.manage_channels) throw new ExecutorError('DISCORD_PERMISSION_DENIED',424);
      // Capture a fresh structural backup before the first Discord mutation.
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(current)))),b=>b.toString(16).padStart(2,'0')).join('');
      const backupId = checked(await db.rpc('discord_save_scan',{p_job_id:jobId,p_structure:current,p_checksum:hash})).data;
      const created = [];
      for(const operation of operations) {
        checked(await db.from('discord_job_operations').insert({job_id:jobId,operation_key:operation.key,resource_type:operation.kind,status:'running'}));
        let discordId:string|undefined;
        try {
          const payload = createPayload(operation,ids,config.guild_id,bot.id);
          const resource = await discordCreate(config.guild_id,operation.kind,payload,token,jobId!);
          discordId=resource.id; ids.set(operation.key,resource.id);
          checked(await db.from('discord_resource_mappings').upsert({guild_id:config.guild_id,discord_id:resource.id,resource_type:operation.kind,logical_key:operation.key,name:resource.name,parent_id:resource.parent_id||null,managed_by_nexium:true,snapshot_id:backupId,last_seen_at:new Date().toISOString()}));
          checked(await db.from('discord_job_operations').update({status:'succeeded',discord_id:resource.id,finished_at:new Date().toISOString()}).eq('job_id',jobId).eq('operation_key',operation.key));
          checked(await db.from('discord_job_logs').insert({job_id:jobId,level:'info',code:'RESOURCE_CREATED',details:{key:operation.key,discord_id:resource.id}}));
          created.push({key:operation.key,discord_id:resource.id});
        } catch(error) {
          const code=error instanceof ExecutorError?error.code:'MUTATION_RESULT_UNCERTAIN_RESCAN';
          const uncertain=!!discordId || code==='MUTATION_RESULT_UNCERTAIN_RESCAN';
          await db.from('discord_job_operations').update({status:uncertain?'uncertain':'failed',discord_id:discordId,error_code:code,finished_at:new Date().toISOString()}).eq('job_id',jobId).eq('operation_key',operation.key);
          throw error;
        }
      }
      // Publish/sync the two interactive Nexium panels after channel IDs are resolved.
      // Existing panels are reused, so applying the organizer again does not spam duplicate messages.
      const publishedPanels:any[]=[];
      const panelTargets=[{key:'channel:produtos',kind:'sales',name:'🛒 Loja Nexium'},{key:'channel:abrirticket',kind:'tickets',name:'🎫 Central de Atendimento'}];
      const products=checked(await db.from('products').select('id').eq('active',true).order('name').limit(25)).data as any[];
      for(const target of panelTargets){
        const channelId=ids.get(target.key); if(!channelId) continue;
        if(target.kind==='sales'&&!products.length) continue;
        let panel=checked(await db.from('discord_sales_panels').select('*').eq('guild_id',config.guild_id).eq('channel_id',channelId).eq('panel_kind',target.kind).eq('active',true).maybeSingle()).data;
        if(!panel){
          panel=checked(await db.from('discord_sales_panels').insert({name:target.name,slug:`organizer-${target.kind}-${channelId}`,guild_id:config.guild_id,channel_id:channelId,product_ids:target.kind==='sales'?products.map(p=>p.id):[],panel_kind:target.kind,active:true,created_by:actorId,sync_status:'pending'}).select('*').single()).data;
        }else if(target.kind==='sales'){
          panel=checked(await db.from('discord_sales_panels').update({product_ids:products.map(p=>p.id),sync_status:'pending'}).eq('id',panel.id).select('*').single()).data;
        }
        await publishPanel(db,config.guild_id,channelId,actorId!,panel.id);
        publishedPanels.push({kind:target.kind,channel_id:channelId,panel_id:panel.id});
      }
      const infoTargets=[
        {key:'channel:regras',title:'📌 | Regras da Nexium Store',description:'Mantenha o respeito, não faça spam e não divulgue conteúdo ou links sem autorização. Use cada canal para sua finalidade e siga as orientações da equipe.'},
        {key:'channel:termos',title:'📜 | Termos da Nexium Store',description:'Leia as regras de compra, entrega e garantia informadas em cada produto antes de concluir o pedido. Para dúvidas sobre uma compra, utilize a Central de Atendimento.'},
        {key:'channel:solicitarproduto',title:'📦 | Solicitar novo produto',description:'Não encontrou o produto que procura? Envie neste canal o nome do produto, plano ou duração desejada. A equipe poderá analisar a solicitação.'},
        {key:'channel:boasvindas',title:'👋 | Bem-vindo à Nexium Store',description:'Seu universo digital em um só lugar. Confira os produtos disponíveis e utilize a Central de Atendimento quando precisar de ajuda.'},
        {key:'channel:duvidas',title:'💬 | Dúvidas',description:'Use este canal para dúvidas rápidas sobre a loja. Para pedidos, pagamentos, entregas ou problemas que precisem de atendimento privado, abra um ticket na Central de Atendimento.'},
      ];
      const infoMessages:any[]=[];
      for(const item of infoTargets){
        const channelId=ids.get(item.key); if(!channelId) continue;
        const payload={content:null,allowed_mentions:{parse:[]},embeds:[{title:item.title,description:item.description,color:0x5865f2,footer:{text:'Nexium Store'}}]};
        const logicalKey=`panel:${item.key}`;
        const mapped=checked(await db.from('discord_resource_mappings').select('discord_id').eq('guild_id',config.guild_id).eq('resource_type','message').eq('logical_key',logicalKey).maybeSingle()).data;
        let message=mapped?.discord_id?await discordUpdateMessage(channelId,mapped.discord_id,payload,token):null;
        if(!message)message=await discordCreateMessage(channelId,payload,token);
        checked(await db.from('discord_resource_mappings').upsert({guild_id:config.guild_id,discord_id:message.id,resource_type:'message',logical_key:logicalKey,name:item.title,parent_id:channelId,managed_by_nexium:true,snapshot_id:backupId,last_seen_at:new Date().toISOString()}));
        infoMessages.push({key:item.key,channel_id:channelId,message_id:message.id});
      }
      result={created,backup_snapshot_id:backupId,reused:preview.result.operations.filter((o:{action:string})=>o.action==='reuse').length,destructive_operations:0,published_panels:publishedPanels,published_info_messages:infoMessages,panel_publication_pending:false};
    } else {
      const { data: snapshot } = checked(await db.from('discord_structure_snapshots').select('*').eq('guild_id', config.guild_id).order('created_at', { ascending: false }).limit(1).maybeSingle());
      if (!snapshot || Date.now() - Date.parse(snapshot.created_at) > 600000) throw new ExecutorError('FRESH_SCAN_REQUIRED', 409);
      const { data: mappings } = checked(await db.from('discord_resource_mappings').select('logical_key,discord_id,resource_type').eq('guild_id', config.guild_id).not('logical_key', 'is', null));
      const plan = planStructure(snapshot.structure, templateStructure(config), mappings || [], strategy as Strategy);
      // Preserve unambiguous logical bindings across later renames. Existing resources remain unowned.
      for (const operation of plan.operations) {
        if (operation.discord_id) checked(await db.from('discord_resource_mappings').update({ logical_key: operation.key }).eq('guild_id', config.guild_id).eq('discord_id', operation.discord_id));
      }
      result = { ...plan, executable: ['missing','reuse'].includes(strategy) && plan.executable, executor_pending: !['missing','reuse'].includes(strategy), snapshot_id: snapshot.id, checksum: snapshot.checksum, config_updated_at: config.updated_at };
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
