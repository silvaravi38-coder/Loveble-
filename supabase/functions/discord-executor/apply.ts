import { ExecutorError } from './discord.ts';
import { normalizeName, type Resource, type Snapshot } from './planner.ts';

export type Operation = { key: string; kind: string; name: string; action: string; discord_id?: string; parentKey?: string; permission_mode?: string };
// Channel display ordering is not part of this plan: PATCH sets only parent/ACL.
// Role hierarchy, resource IDs, parents and ACLs remain protected by drift checks.
export function structureFingerprint(snapshot: Snapshot) {
  const channels = snapshot.channels.map(c => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id || null, permission_overwrites: (c.permission_overwrites || []).map((o:any)=>({id:String(o.id),type:Number(o.type),allow:String(o.allow||'0'),deny:String(o.deny||'0')})).sort((a,b)=>a.id.localeCompare(b.id)||a.type-b.type) })).sort((a,b) => a.id.localeCompare(b.id));
  const roles = snapshot.roles.map(r => ({ id: r.id, name: r.name, position: r.position || 0, permissions: r.permissions || '0', managed: !!r.managed })).sort((a,b) => a.id.localeCompare(b.id));
  return JSON.stringify({ guild_id: snapshot.guild.id, channels, roles });
}

export function requireCreatePlan(plan: { strategy: string; operations: Operation[]; config_updated_at: string }, configUpdatedAt: string, before: Snapshot, current: Snapshot) {
  if (!['missing','reuse','reorganize'].includes(plan.strategy)) throw new ExecutorError('CONFIRMED_REORGANIZATION_NOT_IMPLEMENTED',409);
  if (plan.config_updated_at !== configUpdatedAt) throw new ExecutorError('CONFIG_CHANGED_REVIEW_PREVIEW',409);
  if (structureFingerprint(before) !== structureFingerprint(current)) throw new ExecutorError('SERVER_CHANGED_RESCAN_REQUIRED',409);
  if (plan.operations.some(o => !['create','reuse','missing',...(plan.strategy==='reorganize'?['move']:[])].includes(o.action))) throw new ExecutorError('PLAN_HAS_CONFLICTS',409);
  const live = [...current.channels,...current.roles];
  const ids = new Map<string,string>();
  for (const operation of plan.operations) {
    if (['reuse','move'].includes(operation.action)) {
      const resource = live.find(r => r.id === operation.discord_id);
      if (!resource || (operation.kind==='channel' && resource.type!==0) || (operation.kind==='category' && resource.type!==4) || (operation.kind === 'role' && (resource.managed || resource.id === current.guild.id))) throw new ExecutorError('PROTECTED_OR_MISSING_RESOURCE',409);
      ids.set(operation.key,resource.id);
    }
  }
  // A fresh snapshot is required after a partially successful job; never retry creates blindly.
  const operations = plan.operations.filter(o => o.action === 'create' || o.action === 'move').sort((a,b) => ['role','category','channel'].indexOf(a.kind)-['role','category','channel'].indexOf(b.kind));
  return { ids, operations };
}

export function createPayload(operation: Operation, ids: Map<string,string>, guildId: string, botId: string) {
  if (operation.kind === 'role') return { name: operation.name, permissions: '0', mentionable: false, hoist: false };
  const categoryKey = operation.kind === 'category' ? operation.key : operation.parentKey;
  const privateArea = ['category:equipe','category:pedidos'].includes(categoryKey || '');
  const permissions = (1n<<10n)|(1n<<11n)|(1n<<14n)|(1n<<15n)|(1n<<16n);
  const overwrites = privateArea ? [
    { id:guildId, type:0, allow:'0', deny:String(1n<<10n) },
    { id:botId, type:1, allow:String(permissions), deny:'0' },
    ...['role:suporte','role:gerente'].flatMap(key => ids.has(key) ? [{id:ids.get(key)!,type:0,allow:String(permissions),deny:'0'}] : []),
  ] : undefined;
  if (operation.kind === 'category') return { name:operation.name,type:4,...(overwrites ? {permission_overwrites:overwrites}: {}) };
  if (operation.kind !== 'channel') throw new ExecutorError('INVALID_OPERATION_KIND',409);
  const parent = operation.parentKey && ids.get(operation.parentKey);
  if (!parent) throw new ExecutorError('PARENT_CATEGORY_REQUIRED',409);
  return { name:operation.name,type:0,parent_id:parent,...(overwrites ? {permission_overwrites:overwrites}: {}) };
}

export async function discordCreate(guildId:string, kind:string, payload:Record<string,unknown>, token:string, jobId:string, fetcher:typeof fetch=fetch) {
  const endpoint = kind === 'role' ? 'roles' : 'channels';
  let result:Response;
  try {
    result = await fetcher(`https://discord.com/api/v10/guilds/${guildId}/${endpoint}`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json','X-Audit-Log-Reason':encodeURIComponent(`Nexium job ${jobId}`)},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  } catch { throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502); }
  if (result.status===429) throw new ExecutorError('DISCORD_RATE_LIMIT',429);
  if (result.status===401) throw new ExecutorError('DISCORD_TOKEN_INVALID',424);
  if (result.status===403) throw new ExecutorError('DISCORD_PERMISSION_DENIED',424);
  if (result.status>=500) throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);
  if (!result.ok) throw new ExecutorError('DISCORD_CREATE_REJECTED',409);
  const resource:Resource = await result.json();
  if (!resource.id || normalizeName(resource.name)!==normalizeName(String(payload.name))) throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);
  return resource;
}

// PATCH moves retain channel IDs and message history. Never delete or recreate a channel.
export async function discordMove(operation:Operation,ids:Map<string,string>,guildId:string,token:string,jobId:string,botId:string,fetcher:typeof fetch=fetch) {
  const parent=operation.parentKey&&ids.get(operation.parentKey);
  if(operation.kind!=='channel'||!operation.discord_id||!parent)throw new ExecutorError('PARENT_CATEGORY_REQUIRED',409);
  const payload=createPayload(operation,ids,guildId,botId);
  const permissions=operation.permission_mode==='staff_only'&&'permission_overwrites' in payload?payload.permission_overwrites:undefined;
  let response:Response;
  try {response=await fetcher(`https://discord.com/api/v10/channels/${operation.discord_id}`,{method:'PATCH',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json','X-Audit-Log-Reason':encodeURIComponent(`Nexium job ${jobId}`)},body:JSON.stringify({parent_id:parent,...(permissions?{permission_overwrites:permissions}:{})}),signal:AbortSignal.timeout(8000)});}
  catch{throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);}
  if(response.status===403)throw new ExecutorError('DISCORD_PERMISSION_DENIED',424);
  if(response.status===429)throw new ExecutorError('DISCORD_RATE_LIMIT',429);
  if(response.status>=500)throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);
  if(!response.ok)throw new ExecutorError('DISCORD_MOVE_REJECTED',409);
  const resource:Resource=await response.json();
  if(resource.id!==operation.discord_id||resource.parent_id!==parent)throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);
  return resource;
}
