export class ExecutorError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, httpStatus = 400) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
// Bounded read helper. Mutation handlers implement their own stricter retry policies.
export async function discordGet(path: string, token: string, onAttempt: (attempt: number) => Promise<void>, fetcher: typeof fetch = fetch, delay = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await onAttempt(attempt);
    let response: Response;
    try {
      response = await fetcher(`https://discord.com/api/v10${path}`, {
        method: 'GET', headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000),
      });
    } catch {
      if (attempt === 3) throw new ExecutorError('DISCORD_NETWORK', 502);
      await delay(attempt * 250); continue;
    }
    if (response.ok) return response.json();
    if (response.status === 401) throw new ExecutorError('DISCORD_TOKEN_INVALID', 424);
    if (response.status === 403) throw new ExecutorError('DISCORD_PERMISSION_DENIED', 424);
    if (response.status === 404) throw new ExecutorError('DISCORD_GUILD_OR_RESOURCE_NOT_FOUND', 424);
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const waitSeconds = Number(body.retry_after || 1);
      if (!Number.isFinite(waitSeconds) || waitSeconds > 3 || attempt === 3) throw new ExecutorError('DISCORD_RATE_LIMIT', 429);
      await delay(Math.max(0, waitSeconds) * 1000); continue;
    }
    if (response.status >= 500 && attempt < 3) { await delay(attempt * 250); continue; }
    throw new ExecutorError('DISCORD_API_ERROR', 502);
  }
  throw new ExecutorError('DISCORD_API_ERROR', 502);
}

export async function discordCreateMessage(channelId:string,body:unknown,token:string,fetcher:typeof fetch=fetch){
  let response:Response;
  try{response=await fetcher(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});}catch{throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);}
  if(response.ok)return response.json();
  if(response.status===401)throw new ExecutorError('DISCORD_TOKEN_INVALID',424);
  if(response.status===403)throw new ExecutorError('DISCORD_PERMISSION_DENIED',424);
  if(response.status===429)throw new ExecutorError('DISCORD_RATE_LIMIT',429);
  if(response.status>=500)throw new ExecutorError('MUTATION_RESULT_UNCERTAIN_RESCAN',502);
  throw new ExecutorError('DISCORD_API_ERROR',502);
}
