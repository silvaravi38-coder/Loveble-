import nacl from "tweetnacl";

export const C = { main: 0x5865f2, ok: 0x00ff7f, err: 0xff4b4b, warn: 0xffb900, bg: 0x2b2d31 };

export const PERM = {
  VIEW: 1n << 10n,
  SEND: 1n << 11n,
  EMBED: 1n << 14n,
  ATTACH: 1n << 15n,
  HISTORY: 1n << 16n,
};

export function verify(raw: string, h: Headers) {
  const sig = h.get("x-signature-ed25519");
  const ts = h.get("x-signature-timestamp");
  const key = process.env.DISCORD_PUBLIC_KEY;
  if (!sig || !ts || !key) return false;
  try {
    return nacl.sign.detached.verify(Buffer.from(ts + raw), Buffer.from(sig, "hex"), Buffer.from(key, "hex"));
  } catch {
    return false;
  }
}

export async function api(method: string, path: string, body?: unknown) {
  const r = await fetch("https://discord.com/api/v10" + path, {
    method,
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`discord ${r.status} ${method} ${path}`);
  return r.status === 204 ? null : r.json();
}
