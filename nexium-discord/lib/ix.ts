/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { api } from "@/lib/discord";
import { ephemeral, type Kind } from "@/lib/embeds";

export const J = (data: unknown) => NextResponse.json(data);
export const eph = (text: string, kind: Kind = "err") => J(ephemeral(text, kind));
export const edit = (i: any, data: object) => api("PATCH", `/webhooks/${i.application_id}/${i.token}/messages/@original`, data);
export const say = (channelId: string, data: object) => api("POST", `/channels/${channelId}/messages`, data);
export const uid = (i: any): string | undefined => i.member?.user?.id ?? i.user?.id;
export const isAdmin = (i: any) => {
  try { return (BigInt(i.member?.permissions ?? 0) & 8n) !== 0n; } catch { return false; }
};
export const isStaff = (i: any, cfg: any) => isAdmin(i) || (!!cfg?.staff_role_id && !!i.member?.roles?.includes(cfg.staff_role_id));
export const getCfg = async (guildId: string) => (await db.from("discord_settings").select().eq("guild_id", guildId).maybeSingle()).data;

export const out = (update: boolean, data: object) => J({ type: update ? 7 : 4, data: update ? data : { flags: 64, ...data } });
export const row = (...components: object[]) => ({ type: 1, components });
export const button = (label: string, custom_id: string, style = 2, disabled = false) => ({ type: 2, style, label, custom_id, disabled });
export const select = (custom_id: string, options: any[], extra: object = {}) => ({ type: 1, components: [{ type: 3, custom_id, options, ...extra }] });

export function input(id: string, label: string, options: { paragraph?: boolean; max?: number; required?: boolean; value?: string; placeholder?: string } = {}) {
  const max = options.max ?? (options.paragraph ? 4000 : 100);
  return { type: 1, components: [{
    type: 4, custom_id: id, label: label.slice(0, 45), style: options.paragraph ? 2 : 1,
    max_length: max, required: options.required ?? true,
    ...(options.value ? { value: options.value.slice(0, max) } : {}),
    ...(options.placeholder ? { placeholder: options.placeholder.slice(0, 100) } : {}),
  }] };
}
export const modalOf = (custom_id: string, title: string, components: object[]) => J({ type: 9, data: { custom_id, title: title.slice(0, 45), components } });
export const fields = (i: any): Record<string, string> => Object.fromEntries(
  (i.data.components ?? []).map((r: any) => [r.components[0].custom_id, String(r.components[0].value ?? "").trim()]),
);

// Accepts Brazilian and dot-decimal formats, without silently turning malformed text into zero.
export function parsePrice(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw || !/^[\d.,]+$/.test(raw)) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount < 1e7 ? Math.round(amount * 100) : null;
}
export const parseYes = (value: string) => /^(s|sim|y|yes|1|true)$/i.test(value.trim());
