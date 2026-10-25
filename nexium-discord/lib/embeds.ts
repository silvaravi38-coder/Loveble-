/* eslint-disable @typescript-eslint/no-explicit-any */
// Padrão visual único do bot: tickets, pedidos e logs usam estas funções.
import { api, C } from "@/lib/discord";
import { db } from "@/lib/db";

export type Kind = "main" | "ok" | "err" | "warn";
export const COLOR: Record<Kind, number> = { main: C.main, ok: C.ok, err: C.err, warn: C.warn };

export const note = (text: string, kind: Kind = "main") => ({ description: text, color: COLOR[kind] });
// Resposta privada curta (só quem clicou vê).
export const ephemeral = (text: string, kind: Kind = "err") => ({ type: 4, data: { flags: 64, embeds: [note(text, kind)] } });
export const rel = (d: Date | string | number) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;

export type LogEvent = { action: string; ref?: string; client?: string; staff?: string; result?: string; kind?: Kind };

// Uma embed compacta por evento: ação, registro, cliente, atendente, resultado e horário.
export function logEmbed(e: LogEvent) {
  const fields = ([["Registro", e.ref], ["Cliente", e.client], ["Atendente", e.staff], ["Resultado", e.result]] as [string, string | undefined][])
    .filter(([, v]) => v)
    .map(([name, value]) => ({ name, value: value as string, inline: true }));
  return { title: e.action, color: COLOR[e.kind ?? "main"], fields, timestamp: new Date().toISOString() };
}

export async function logEvent(guildId: string, e: LogEvent) {
  const { data: cfg } = await db.from("discord_settings").select("log_channel_id").eq("guild_id", guildId).maybeSingle();
  if (!cfg?.log_channel_id) return;
  await api("POST", `/channels/${cfg.log_channel_id}/messages`, { embeds: [logEmbed(e)], allowed_mentions: { parse: [] } }).catch(() => {});
}

export async function dm(userId: string, text: string, kind: Kind = "main") {
  await dmTry(userId, { embeds: [{ ...note(text, kind), title: "Nexium Store" }] });
}

// Returns false when the recipient has DMs closed or Discord rejects the message.
export async function dmTry(userId: string, body: object): Promise<boolean> {
  try {
    const ch = await api("POST", "/users/@me/channels", { recipient_id: userId });
    await api("POST", `/channels/${ch.id}/messages`, body);
    return true;
  } catch {
    return false;
  }
}
