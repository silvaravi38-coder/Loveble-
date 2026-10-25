/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { api, verify, C, PERM } from "@/lib/discord";
import { isOpen } from "@/lib/hours";
import { couponSubmit, handleSales } from "@/lib/sales";
import { ephemeral, logEmbed, logEvent, note, rel, type Kind } from "@/lib/embeds";
import { buildTranscript, sendFile } from "@/lib/transcript";

const J = (d: unknown) => NextResponse.json(d);
const eph = (t: string, k: Kind = "err") => J(ephemeral(t, k));
const edit = (i: any, data: object) => api("PATCH", `/webhooks/${i.application_id}/${i.token}/messages/@original`, data);
const say = (ch: string, data: object) => api("POST", `/channels/${ch}/messages`, data);
const uid = (i: any): string => i.member.user.id;
const isAdmin = (i: any) => (BigInt(i.member?.permissions ?? 0) & 8n) !== 0n;
const isStaff = (i: any, cfg: any) => isAdmin(i) || (!!cfg?.staff_role_id && i.member.roles.includes(cfg.staff_role_id));
const getCfg = async (g: string) => (await db.from("discord_settings").select().eq("guild_id", g).maybeSingle()).data;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verify(raw, req.headers)) return new NextResponse("invalid", { status: 401 });
  const i = JSON.parse(raw);
  if (i.type === 1) return J({ type: 1 });
  try {
    if (i.type === 2 && i.data.name === "config") return await configMenu(i);
    if (i.type === 3) return await component(i);
    if (i.type === 5) return await modal(i);
  } catch (e) {
    console.error("interaction", e);
  }
  return eph("Algo deu errado. Tente de novo em instantes.");
}

async function configMenu(i: any) {
  if (!isAdmin(i)) return eph("Só administradores podem usar isso.");
  const g = i.guild_id;
  await db.from("discord_settings").upsert({ guild_id: g }, { onConflict: "guild_id", ignoreDuplicates: true });
  const { count } = await db.from("ticket_sectors").select("id", { count: "exact", head: true }).eq("guild_id", g);
  if (!count) {
    await db.from("ticket_sectors").insert([
      { guild_id: g, name: "Suporte", description: "Dúvidas e problemas com pedidos." },
      { guild_id: g, name: "Compras", description: "Ajuda para comprar ou receber seu produto." },
      { guild_id: g, name: "Solicitar Produtos para Estoque", description: "Peça a inclusão de produtos.", cooldown_seconds: 180 },
    ]);
  }
  return J({ type: 4, data: { flags: 64, embeds: [note("Escolha o que configurar.")], components: [
    { type: 1, components: [{ type: 6, custom_id: "cfg:staff", placeholder: "Cargo da equipe" }] },
    { type: 1, components: [{ type: 8, custom_id: "cfg:logs", placeholder: "Canal de logs", channel_types: [0] }] },
    { type: 1, components: [{ type: 8, custom_id: "cfg:cat", placeholder: "Categoria dos tickets", channel_types: [4] }] },
    { type: 1, components: [{ type: 8, custom_id: "cfg:orders", placeholder: "Canal de pedidos da equipe", channel_types: [0] }] },
    { type: 1, components: [
      { type: 2, style: 1, label: "Novo setor", custom_id: "cfg:sector" },
      { type: 2, style: 3, label: "Publicar painel aqui", custom_id: "cfg:publish" },
      { type: 2, style: 1, label: "Painel de vendas", custom_id: "cfg:sales" },
      { type: 2, style: 2, label: "Canal de avaliações", custom_id: "cfg:reviews" },
      { type: 2, style: 2, label: "Cargo Cliente", custom_id: "cfg:customerrole" },
    ] },
  ] } });
}

const field = (id: string, label: string, max: number, required = true) => ({
  type: 1, components: [{ type: 4, custom_id: id, label, style: 1, max_length: max, required }],
});

async function component(i: any) {
  const [ns, act, arg] = i.data.custom_id.split(":");
  const g = i.guild_id;
  const sales = await handleSales(i);
  if (sales) return sales;

  if (ns === "cfg") {
    if (!isAdmin(i)) return eph("Só administradores podem usar isso.");
    if (act === "sector") {
      return J({ type: 9, data: { custom_id: "cfg:sector", title: "Novo setor", components: [
        field("name", "Nome", 30), field("description", "Descrição curta", 100, false), field("cooldown", "Espera entre tickets (minutos)", 4, false),
      ] } });
    }
    if (act === "publish") {
      const { data: sectors } = await db.from("ticket_sectors").select().eq("guild_id", g).eq("active", true).order("created_at").limit(25);
      if (!sectors?.length) return eph("Crie um setor antes de publicar.", "warn");
      const rows = [];
      for (let n = 0; n < sectors.length; n += 5) {
        rows.push({ type: 1, components: sectors.slice(n, n + 5).map((s: any) => ({ type: 2, style: 1, label: s.name, custom_id: `tk:open:${s.id}` })) });
      }
      await say(i.channel_id, { embeds: [{ title: "Atendimento", description: "Escolha um setor para abrir seu ticket.", color: C.main }], components: rows });
      return eph("Painel publicado ✓", "ok");
    }
    if (act === "reviews" && !i.data.values) {
      return J({ type: 4, data: { flags: 64, embeds: [note("Escolha o canal onde as avaliações serão publicadas.")], components: [
        { type: 1, components: [{ type: 8, custom_id: "cfg:reviews:set", placeholder: "Canal de avaliações", channel_types: [0] }] },
      ] } });
    }
    if (act === "customerrole" && !i.data.values) {
      return J({ type: 4, data: { flags: 64, embeds: [note("Escolha o cargo que clientes receberão após o pagamento confirmado.")], components: [
        { type: 1, components: [{ type: 6, custom_id: "cfg:customerrole:set", placeholder: "Cargo de cliente" }] },
      ] } });
    }
    const col = ({ staff: "staff_role_id", logs: "log_channel_id", cat: "category_id", orders: "orders_channel_id", reviews: "reviews_channel_id", customerrole: "customer_role_id" } as Record<string, string>)[act];
    const v = i.data.values?.[0];
    if (col && v) {
      await db.from("discord_settings").upsert({ guild_id: g, [col]: v });
      return eph("Salvo ✓", "ok");
    }
  }

  if (ns === "tk") {
    if (act === "open") {
      after(() => openTicket(i, arg).catch(async (e) => {
        console.error("open", e);
        await edit(i, { embeds: [note("Não foi possível abrir o ticket agora. Tente de novo.", "err")] }).catch(() => {});
      }));
      return J({ type: 5, data: { flags: 64 } });
    }
    if (act === "claim") return claim(i);
    if (act === "close") return close(i);
  }
  return eph("Essa ação não está disponível.");
}

// Embed única do ticket: é atualizada ao assumir, sem mensagens extras.
const ticketEmbed = (t: any, sector: { name: string; description?: string | null }, claimed: boolean, staffId?: string, footer?: string) => ({
  title: `Ticket #${t.number} · ${sector.name}`,
  description: sector.description ?? "Descreva o que você precisa. A equipe responde por aqui.",
  color: claimed ? C.ok : C.main,
  fields: [
    { name: "Cliente", value: `<@${t.owner_id}>`, inline: true },
    { name: "Setor", value: sector.name, inline: true },
    { name: "Status", value: claimed ? "Em atendimento" : "Aguardando atendimento", inline: true },
    { name: "Responsável", value: staffId ? `<@${staffId}>` : "—", inline: true },
    { name: "Aberto", value: rel(t.opened_at), inline: true },
  ],
  footer: footer ? { text: footer } : undefined,
});

async function openTicket(i: any, sectorId: string) {
  const g = i.guild_id, u = uid(i);
  const [{ data: s }, cfg] = await Promise.all([
    db.from("ticket_sectors").select().eq("id", sectorId).eq("guild_id", g).eq("active", true).maybeSingle(),
    getCfg(g),
  ]);
  if (!s) return void (await edit(i, { embeds: [note("Setor indisponível.", "err")] }));

  if (cfg?.block_duplicates ?? true) {
    const { data: d } = await db.from("tickets").select("channel_id").eq("owner_id", u).eq("sector_id", s.id).neq("status", "closed").limit(1);
    if (d?.length) return void (await edit(i, { embeds: [note(`Você já tem um ticket aberto neste setor: <#${d[0].channel_id}>`, "warn")] }));
  }
  if (s.cooldown_seconds > 0) {
    const { data: l } = await db.from("tickets").select("opened_at").eq("owner_id", u).eq("sector_id", s.id).order("opened_at", { ascending: false }).limit(1);
    if (l?.[0]) {
      const wait = s.cooldown_seconds - (Date.now() - new Date(l[0].opened_at).getTime()) / 1000;
      if (wait > 0) return void (await edit(i, { embeds: [note(`Aguarde ${Math.ceil(wait)}s para abrir outro ticket neste setor.`, "warn")] }));
    }
  }

  const { data: t, error } = await db.from("tickets").insert({ guild_id: g, owner_id: u, sector_id: s.id }).select().single();
  if (error || !t) throw error;

  const slug = s.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  const view = PERM.VIEW | PERM.SEND | PERM.HISTORY | PERM.ATTACH;
  const overwrites: any[] = [
    { id: g, type: 0, allow: "0", deny: String(PERM.VIEW) },
    { id: u, type: 1, allow: String(view), deny: "0" },
    { id: i.application_id, type: 1, allow: String(view | PERM.EMBED), deny: "0" },
  ];
  if (cfg?.staff_role_id) overwrites.push({ id: cfg.staff_role_id, type: 0, allow: String(view), deny: "0" });

  const ch = await api("POST", `/guilds/${g}/channels`, {
    name: `${slug}-${String(t.number).padStart(4, "0")}`, type: 0, parent_id: cfg?.category_id ?? undefined,
    permission_overwrites: overwrites, topic: `Ticket #${t.number} · ${s.name}`,
  });
  await db.from("tickets").update({ channel_id: ch.id }).eq("id", t.id);

  const open = isOpen(cfg?.hours ?? {}, new Date());
  const roles = cfg?.staff_role_id ? [cfg.staff_role_id] : [];
  await say(ch.id, {
    content: `<@${u}>${roles.length ? ` <@&${roles[0]}>` : ""}`,
    allowed_mentions: { users: [u], roles },
    embeds: [ticketEmbed(t, s, false, undefined, open ? undefined : "Fora do horário de atendimento. Respondemos assim que possível.")],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: "Assumir", custom_id: "tk:claim" },
      { type: 2, style: 4, label: "Encerrar", custom_id: "tk:close" },
    ] }],
  });
  await db.from("ticket_events").insert({ ticket_id: t.id, type: "opened", actor_id: u });
  await logEvent(g, { action: "Ticket aberto", ref: `Ticket #${t.number} · ${s.name}`, client: `<@${u}>`, result: "Aguardando atendimento", kind: "main" });
  await edit(i, { embeds: [note(`Seu ticket: <#${ch.id}>`, "ok")] });
}

async function claim(i: any) {
  const cfg = await getCfg(i.guild_id);
  if (!isStaff(i, cfg)) return eph("Só a equipe pode assumir tickets.");
  const { data: t } = await db.from("tickets")
    .update({ status: "claimed", claimed_by: uid(i), claimed_at: new Date().toISOString() })
    .eq("channel_id", i.channel_id).eq("status", "open").is("claimed_by", null)
    .select("*, ticket_sectors(name, description)").maybeSingle();
  if (!t) return eph("Este ticket já foi assumido ou encerrado.", "warn");
  await db.from("ticket_events").insert({ ticket_id: t.id, type: "claimed", actor_id: uid(i) });
  after(() => logEvent(i.guild_id, { action: "Ticket assumido", ref: `Ticket #${t.number} · ${t.ticket_sectors.name}`, client: `<@${t.owner_id}>`, staff: `<@${uid(i)}>`, result: "Em atendimento", kind: "ok" }));
  return J({ type: 7, data: {
    embeds: [ticketEmbed(t, t.ticket_sectors, true, uid(i))],
    components: [{ type: 1, components: [
      { type: 2, style: 2, label: "Assumido", custom_id: "tk:claim", disabled: true },
      { type: 2, style: 4, label: "Encerrar", custom_id: "tk:close" },
    ] }],
  } });
}

async function close(i: any) {
  const cfg = await getCfg(i.guild_id);
  const { data: t } = await db.from("tickets").select("*, ticket_sectors(name)").eq("channel_id", i.channel_id).maybeSingle();
  if (!t || t.status === "closed") return eph("Este ticket já foi encerrado.", "warn");
  if (!isStaff(i, cfg) && t.owner_id !== uid(i)) return eph("Você não pode encerrar este ticket.");
  const del = new Date(Date.now() + (cfg?.auto_delete_minutes ?? 5) * 60000);
  const { data: u } = await db.from("tickets")
    .update({ status: "closed", closed_by: uid(i), closed_at: new Date().toISOString(), delete_at: del.toISOString() })
    .eq("id", t.id).neq("status", "closed").select().maybeSingle();
  if (!u) return eph("Este ticket já foi encerrado.", "warn");
  await db.from("ticket_events").insert({ ticket_id: t.id, type: "closed", actor_id: uid(i) });

  const mins = Math.max(1, Math.round((Date.now() - new Date(t.opened_at).getTime()) / 60000));
  const sector = t.ticket_sectors.name;
  const staff = t.claimed_by ? `<@${t.claimed_by}>` : undefined;
  const summary = `${sector} · aberto por <@${t.owner_id}> · ${staff ? `atendido por ${staff}` : "sem responsável"} · ${mins} min`;

  after(async () => {
    const ev = { action: "Ticket encerrado", ref: `Ticket #${t.number} · ${sector}`, client: `<@${t.owner_id}>`, staff, result: `Encerrado por <@${uid(i)}> em ${mins} min`, kind: "err" as Kind };
    if (cfg?.log_channel_id && (cfg.save_transcripts ?? true)) {
      try {
        const text = await buildTranscript(i.channel_id);
        await sendFile(cfg.log_channel_id, `ticket-${String(t.number).padStart(4, "0")}.txt`, text, { embeds: [logEmbed(ev)], allowed_mentions: { parse: [] } });
        return;
      } catch (e) { console.error("transcript", e); }
    }
    await logEvent(i.guild_id, ev);
  });

  return J({ type: 7, data: { components: [], embeds: [{
    title: `Ticket #${t.number} encerrado`, color: C.err,
    description: `Este canal será apagado ${rel(del)}.`,
    fields: [
      { name: "Cliente", value: `<@${t.owner_id}>`, inline: true },
      { name: "Setor", value: sector, inline: true },
      { name: "Responsável", value: staff ?? "—", inline: true },
      { name: "Encerrado por", value: `<@${uid(i)}>`, inline: true },
      { name: "Duração", value: `${mins} min`, inline: true },
      { name: "Resumo", value: summary },
    ],
  }] } });
}

async function modal(i: any) {
  if (String(i.data.custom_id ?? "").startsWith("vp:cupom:")) return couponSubmit(i) ?? eph("Cupom inválido.", "warn");
  if (i.data.custom_id !== "cfg:sector") return eph("Essa ação não está disponível.");
  if (!isAdmin(i)) return eph("Só administradores podem usar isso.");
  const f = Object.fromEntries(i.data.components.map((r: any) => [r.components[0].custom_id, (r.components[0].value ?? "").trim()]));
  const mins = f.cooldown ? Number(f.cooldown) : 0;
  if (f.name.length < 2 || !Number.isFinite(mins) || mins < 0 || mins > 1440) return eph("Confira os campos: nome e espera em minutos (0 a 1440).", "warn");
  await db.from("ticket_sectors").insert({ guild_id: i.guild_id, name: f.name, description: f.description || null, cooldown_seconds: Math.round(mins * 60) });
  after(() => logEvent(i.guild_id, { action: "Setor criado", ref: `Setor ${f.name}`, staff: `<@${uid(i)}>`, result: "Criado", kind: "ok" }));
  return eph("Setor criado ✓ Publique o painel para ele aparecer.", "ok");
}
