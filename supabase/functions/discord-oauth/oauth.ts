export const applicationId = '1557132199227031552';
export const callbackUrl = 'https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-oauth';
export const storeUrl = 'https://nexium-store.vercel.app';
export const validState = (value: string) => /^[a-f0-9]{64}$/.test(value);
export async function stateHash(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function authorizationUrl(state:string) {
  if (!validState(state)) throw new Error('INVALID_STATE');
  const url=new URL('https://discord.com/oauth2/authorize');
  url.search=new URLSearchParams({client_id:applicationId,redirect_uri:callbackUrl,response_type:'code',scope:'identify',state,prompt:'consent'}).toString();
  return url.toString();
}
export async function exchangeIdentity(code:string,secret:string,fetcher:typeof fetch=fetch) {
  const result=await fetcher('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:applicationId,client_secret:secret,grant_type:'authorization_code',code,redirect_uri:callbackUrl}),signal:AbortSignal.timeout(8000)});
  if (!result.ok) throw new Error('DISCORD_CODE_EXCHANGE_FAILED');
  const tokens=await result.json();
  if (typeof tokens.access_token!=='string' || tokens.token_type?.toLowerCase()!=='bearer' || !String(tokens.scope).split(' ').includes('identify')) throw new Error('INVALID_DISCORD_TOKEN_RESPONSE');
  const profile=await fetcher('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(8000)});
  if (!profile.ok) throw new Error('DISCORD_IDENTITY_FAILED');
  const user=await profile.json();
  if (!/^[0-9]{17,20}$/.test(user.id) || typeof user.username!=='string' || user.bot) throw new Error('INVALID_DISCORD_IDENTITY');
  // No Discord access/refresh token is returned, stored or logged.
  return {id:user.id as string,username:user.username as string};
}
