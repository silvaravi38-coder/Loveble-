/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from "@/lib/discord";

// Lê até 1000 mensagens do canal e monta um texto simples.
export async function buildTranscript(channelId: string) {
  const all: any[] = [];
  let before: string | undefined;
  for (let k = 0; k < 10; k++) {
    const ms: any[] = await api("GET", `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    if (!ms.length) break;
    all.push(...ms);
    before = ms[ms.length - 1].id;
    if (ms.length < 100) break;
  }
  all.reverse();
  const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return all.map((m) => {
    const parts = [
      m.content,
      ...(m.attachments ?? []).map((a: any) => `[anexo] ${a.url}`),
      ...(m.embeds ?? []).map((e: any) => `[embed] ${e.title ?? ""} ${e.description ?? ""}`.trim()),
    ].filter(Boolean).join(" ");
    return `[${fmt(m.timestamp)}] ${m.author.username}${m.author.bot ? " (bot)" : ""}: ${parts}`;
  }).join("\n");
}

export async function sendFile(channelId: string, filename: string, content: string, payload: object) {
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify(payload));
  fd.append("files[0]", new Blob([content], { type: "text/plain" }), filename);
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST", headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, body: fd,
  });
  if (!r.ok) throw new Error(`discord ${r.status} upload`);
}
