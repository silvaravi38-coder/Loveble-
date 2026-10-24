/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { C, PERM } from "@/lib/discord";
import { buildLayout, type Access, type CatT, type ChanT, type PresetId, type RoleT } from "./templates";

export type Mode = "auto" | "full" | "rebuild";
export type Item = {
  op: "create" | "update" | "remove" | "keep";
  kind: "role" | "category" | "channel";
  name: string; note?: string; id?: string; parent?: string;
  role?: RoleT; cat?: CatT; chan?: ChanT;
};
export type Plan = {
  mode: Mode; preset: PresetId; items: Item[];
  roleIds: Record<string, string>; catIds: Record<string, string>; slots: Record<string, string>;
  ticketsCat?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// REST próprio, com espera quando o Discord pede (429).
async function rest(method: string, path: string, body?: unknown, reason?: string) {
  for (let k = 0; k < 4; k++) {
    const r = await fetch("https://discord.com/api/v10" + path, {
      method,
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) {
      const j: any = await r.json().catch(() => ({}));
      await sleep(Math.min((j.retry_after ?? 1) * 1000, 5000));
      continue;
    }
    if (!r.ok) throw new Error(`discord ${r.status} ${method} ${path}`);
    return r.status === 204 ? null : r.json();
  }
  throw new Error("discord rate limit");
}

export const listGuilds = (): Promise<{ id: string; name: string }[]> => rest("GET", "/users/@me/guilds");

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");
const TEXT = 0, VOICE = 2, CAT = 4;

function overwrites(access: Access, g: string, ids: { admin?: string; staff?: string }): any[] {
  if (access === "public") return [];
  const bot = { id: process.env.DISCORD_APPLICATION_ID!, type: 1, allow: String(PERM.VIEW | PERM.SEND | PERM.EMBED | PERM.HISTORY), deny: "0" };
  const team = [ids.admin, ids.staff].filter(Boolean).map((id) => ({
    id: id as string, type: 0, allow: String(PERM.VIEW | PERM.SEND | PERM.HISTORY | PERM.ATTACH), deny: "0",
  }));
  if (access === "readonly") return [{ id: g, type: 0, allow: String(PERM.VIEW | PERM.HISTORY), deny: String(PERM.SEND) }, bot, ...team];
  return [{ id: g, type: 0, allow: "0", deny: String(PERM.VIEW) }, bot, ...team];
}
const sameOw = (ex: any[] = [], want: any[]) =>
  want.every((w) => ex.some((e) => e.id === w.id && BigInt(e.allow) === BigInt(w.allow) && BigInt(e.deny) === BigInt(w.deny)));

// Calcula a prévia comparando o modelo com o servidor de verdade. Não altera nada.
export async function makePlan(g: string, mode: Mode, preset: PresetId, products: { name: string; category: string | null }[]): Promise<Plan> {
  const eff: PresetId = mode === "auto" ? "enxuta" : preset;
  const layout = buildLayout(eff, products);
  const [roles, chans, guild, { data: open }] = await Promise.all([
    rest("GET", `/guilds/${g}/roles`), rest("GET", `/guilds/${g}/channels`), rest("GET", `/guilds/${g}`),
    db.from("tickets").select("channel_id").eq("guild_id", g).neq("status", "closed"),
  ]);
  const protect = new Set<string>(
    [guild.rules_channel_id, guild.public_updates_channel_id, guild.system_channel_id, guild.afk_channel_id, guild.safety_alerts_channel_id, ...(open ?? []).map((t: any) => t.channel_id)].filter(Boolean)
  );

  const items: Item[] = [];
  const roleIds: Record<string, string> = {}, catIds: Record<string, string> = {}, slots: Record<string, string> = {};
  for (const r of layout.roles) {
    const ex = roles.find((x: any) => !x.managed && x.name.toLowerCase() === r.name.toLowerCase());
    if (ex) roleIds[r.key] = ex.id;
    items.push({ op: ex ? "keep" : "create", kind: "role", name: r.name, role: r, id: ex?.id });
  }
  const idFor = (k: "admin" | "staff") => roleIds[k] ?? `NEW:${k}`;
  const ids = { admin: idFor("admin"), staff: idFor("staff") };
  const matched = new Set<string>();

  for (const c of layout.cats) {
    const ex = chans.find((x: any) => x.type === CAT && !matched.has(x.id) && norm(x.name) === norm(c.name));
    if (ex) {
      matched.add(ex.id); catIds[c.name] = ex.id;
      const need = mode === "rebuild" && !sameOw(ex.permission_overwrites, overwrites(c.access ?? "public", g, ids));
      items.push({ op: need ? "update" : "keep", kind: "category", name: c.name, id: ex.id, cat: c, note: need ? "ajustar permissões" : undefined });
    } else items.push({ op: "create", kind: "category", name: c.name, cat: c });

    for (const ch of c.chans) {
      const type = ch.kind === "voice" ? VOICE : TEXT;
      const ec = chans.find((x: any) => x.type === type && !matched.has(x.id) && norm(x.name) === norm(ch.name));
      if (!ec) { items.push({ op: "create", kind: "channel", name: ch.name, chan: ch, parent: c.name }); continue; }
      matched.add(ec.id);
      if (ch.slot) slots[ch.slot] = ec.id;
      const parentOk = catIds[c.name] !== undefined && ec.parent_id === catIds[c.name];
      const owOk = sameOw(ec.permission_overwrites, overwrites(ch.access, g, ids));
      const topicOk = type !== TEXT || !ch.topic || ec.topic === ch.topic;
      const need = mode === "rebuild" && (!parentOk || !owOk || !topicOk);
      const why = [!parentOk && "mover", !owOk && "permissões", !topicOk && "descrição"].filter(Boolean).join(", ");
      items.push({
        op: need ? "update" : "keep", kind: "channel", name: ch.name, id: ec.id, chan: ch, parent: c.name,
        note: need ? `ajustar: ${why}` : !parentOk && mode !== "rebuild" ? "mantido onde está" : undefined,
      });
    }
  }

  if (mode === "rebuild") {
    const rm = chans.filter((x: any) => x.type !== CAT && !matched.has(x.id) && !protect.has(x.id));
    const rmIds = new Set(rm.map((x: any) => x.id));
    for (const x of rm) items.push({ op: "remove", kind: "channel", name: x.name, id: x.id });
    for (const x of chans.filter((c: any) => c.type === CAT && !matched.has(c.id) && !protect.has(c.id))) {
      const kids = chans.filter((k: any) => k.parent_id === x.id);
      if (kids.every((k: any) => rmIds.has(k.id))) items.push({ op: "remove", kind: "category", name: x.name, id: x.id });
      else items.push({ op: "keep", kind: "category", name: x.name, id: x.id, note: "mantida: tem canais protegidos" });
    }
  }
  return { mode, preset: eff, items, roleIds, catIds, slots, ticketsCat: layout.cats.find((c) => c.slot === "ticketsCat")?.name };
}

async function botPosted(ch: string) {
  const ms: any[] = await rest("GET", `/channels/${ch}/messages?limit=25`);
  return ms.some((m) => m.author?.id === process.env.DISCORD_APPLICATION_ID && m.components?.length);
}

async function ticketsPanel(g: string, ch: string) {
  const { count } = await db.from("ticket_sectors").select("id", { count: "exact", head: true }).eq("guild_id", g);
  if (!count) {
    await db.from("ticket_sectors").insert([
      { guild_id: g, name: "Suporte", description: "Dúvidas e problemas com pedidos." },
      { guild_id: g, name: "Compras", description: "Ajuda para comprar ou receber seu produto." },
      { guild_id: g, name: "Solicitar Produtos para Estoque", description: "Peça a inclusão de produtos.", cooldown_seconds: 180 },
    ]);
  }
  if (await botPosted(ch)) return;
  const { data: ss } = await db.from("ticket_sectors").select().eq("guild_id", g).eq("active", true).order("created_at").limit(25);
  if (!ss?.length) return;
  const rows = [];
  for (let n = 0; n < ss.length; n += 5) rows.push({ type: 1, components: ss.slice(n, n + 5).map((s: any) => ({ type: 2, style: 1, label: s.name, custom_id: `tk:open:${s.id}` })) });
  await rest("POST", `/channels/${ch}/messages`, { embeds: [{ title: "Atendimento", description: "Escolha um setor para abrir seu ticket.", color: C.main }], components: rows });
}

async function salesPanel(g: string, ch: string, notes: string[]) {
  const { data: has } = await db.from("sales_panels").select("id").eq("channel_id", ch).maybeSingle();
  if (has) return;
  const { data: ps } = await db.from("products").select("id,name").eq("active", true).order("created_at").limit(25);
  if (!ps?.length) { notes.push("Sem produtos cadastrados: o painel de vendas não foi publicado."); return; }
  const { data: panel } = await db.from("sales_panels").insert({ guild_id: g, channel_id: ch }).select().single();
  if (!panel) return;
  await db.from("panel_products").insert(ps.map((p: any) => ({ panel_id: panel.id, product_id: p.id })));
  const m = await rest("POST", `/channels/${ch}/messages`, {
    embeds: [{ title: "Loja", description: "Escolha um produto no menu.", color: C.main }],
    components: [{ type: 1, components: [{ type: 3, custom_id: `vp:pick:${panel.id}`, placeholder: "Escolha um produto", options: ps.map((p: any) => ({ label: p.name.slice(0, 100), value: p.id })) }] }],
  });
  await db.from("sales_panels").update({ message_id: m.id }).eq("id", panel.id);
}

// Aplica a prévia. É retomável: se acabar o tempo, uma nova execução recalcula e continua do que falta.
export async function execute(g: string, plan: Plan, opts: { remove: boolean; panels: boolean }, actor: string, budgetMs = 50000) {
  const t0 = Date.now();
  const reason = `Builder · ${actor}`;
  const todo = plan.items.filter((i) => i.op !== "keep" && (i.op !== "remove" || opts.remove));
  const roleIds = { ...plan.roleIds }, catIds = { ...plan.catIds }, slots = { ...plan.slots };
  const n = { create: 0, update: 0, remove: 0 };
  const notes: string[] = [];
  const out = () => Date.now() - t0 > budgetMs;
  let done = 0;
  const finish = (finished: boolean) => ({ finished, done, total: todo.length, notes });
  const step = (op: Item["op"]) => { done++; n[op as "create"]++; };

  for (const it of todo.filter((i) => i.kind === "role")) {
    if (out()) return finish(false);
    const r = await rest("POST", `/guilds/${g}/roles`, { name: it.name, color: it.role!.color, permissions: "0", mentionable: false }, reason);
    roleIds[it.role!.key] = r.id; step("create");
  }
  for (const it of todo.filter((i) => i.kind === "category" && i.op !== "remove")) {
    if (out()) return finish(false);
    const ow = overwrites(it.cat!.access ?? "public", g, roleIds);
    if (it.op === "create") { const r = await rest("POST", `/guilds/${g}/channels`, { name: it.name, type: CAT, permission_overwrites: ow }, reason); catIds[it.name] = r.id; }
    else await rest("PATCH", `/channels/${it.id}`, { permission_overwrites: ow }, reason);
    step(it.op);
  }
  for (const it of todo.filter((i) => i.kind === "channel" && i.op !== "remove")) {
    if (out()) return finish(false);
    const ch = it.chan!;
    const body: any = { parent_id: catIds[it.parent!], permission_overwrites: overwrites(ch.access, g, roleIds) };
    if (ch.kind === "text" && ch.topic) body.topic = ch.topic;
    if (it.op === "create") {
      const r = await rest("POST", `/guilds/${g}/channels`, { name: ch.name, type: ch.kind === "voice" ? VOICE : TEXT, ...body }, reason);
      if (ch.slot) slots[ch.slot] = r.id;
    } else await rest("PATCH", `/channels/${it.id}`, body, reason);
    step(it.op);
  }
  if (opts.remove) {
    for (const kind of ["channel", "category"] as const) {
      for (const it of todo.filter((i) => i.op === "remove" && i.kind === kind)) {
        if (out()) return finish(false);
        try { await rest("DELETE", `/channels/${it.id}`, undefined, reason); } catch (e) { if (!String(e).includes("discord 404")) throw e; }
        step("remove");
      }
    }
  }

  // Tudo aplicado: liga os canais ao bot, publica painéis e registra.
  const { data: cur } = await db.from("discord_settings").select().eq("guild_id", g).maybeSingle();
  const put = (k: string, v?: string) => (v && (plan.mode === "rebuild" || !cur?.[k]) ? { [k]: v } : {});
  await db.from("discord_settings").upsert({
    guild_id: g, ...put("log_channel_id", slots.logs), ...put("orders_channel_id", slots.orders),
    ...put("staff_role_id", roleIds.staff), ...put("category_id", plan.ticketsCat ? catIds[plan.ticketsCat] : undefined),
  });
  if (opts.panels) {
    if (slots.tickets) await ticketsPanel(g, slots.tickets);
    if (slots.sales) await salesPanel(g, slots.sales, notes);
  }
  await db.from("builder_runs").insert({ guild_id: g, mode: plan.mode, preset: plan.preset, actor, created: n.create, updated: n.update, removed: n.remove });
  const logCh = slots.logs ?? cur?.log_channel_id;
  if (logCh) {
    await rest("POST", `/channels/${logCh}/messages`, { embeds: [{
      title: "Builder aplicado", color: C.ok, timestamp: new Date().toISOString(),
      fields: [
        { name: "Por", value: actor, inline: true }, { name: "Criados", value: String(n.create), inline: true },
        { name: "Ajustados", value: String(n.update), inline: true }, { name: "Removidos", value: String(n.remove), inline: true },
      ],
    }] }).catch(() => {});
  }
  return finish(true);
}
