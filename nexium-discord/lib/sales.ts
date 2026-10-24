/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { api, C } from "@/lib/discord";
import { createPixCharge } from "@/lib/pix";
import { afterOrderChange, brl, invoiceEmbed, orderButtons, orderEmbed } from "@/lib/orders";
import { ephemeral, logEvent, note, type Kind } from "@/lib/embeds";

const J = (d: unknown) => NextResponse.json(d);
const eph = (t: string, k: Kind = "err") => J(ephemeral(t, k));
const edit = (i: any, data: object) => api("PATCH", `/webhooks/${i.application_id}/${i.token}/messages/@original`, data);
const say = (ch: string, data: object) => api("POST", `/channels/${ch}/messages`, data);
const uid = (i: any): string => i.member.user.id;
const isAdmin = (i: any) => (BigInt(i.member?.permissions ?? 0) & 8n) !== 0n;
const getCfg = async (g: string) => (await db.from("discord_settings").select().eq("guild_id", g).maybeSingle()).data;
const isStaff = (i: any, cfg: any) => isAdmin(i) || (!!cfg?.staff_role_id && i.member.roles.includes(cfg.staff_role_id));
const select = (custom_id: string, options: any[], extra: object = {}) => ({ type: 1, components: [{ type: 3, custom_id, options, ...extra }] });

// Retorna null quando a interação não é de vendas/pedidos.
export async function handleSales(i: any) {
  const id: string = i.data?.custom_id ?? "";
  const [ns, act, arg] = id.split(":");
  if (id === "cfg:sales") return salesPicker(i);
  if (ns === "vp") {
    if (act === "create") return publishPanel(i);
    if (act === "pick") return pickProduct(i, arg);
    if (act === "var") {
      after(() => createOrder(i).catch(async (e) => {
        console.error("order", e);
        await edit(i, { embeds: [note("Não foi possível criar o pedido agora. Tente de novo.", "err")] }).catch(() => {});
      }));
      return J({ type: 5, data: { flags: 64 } });
    }
  }
  if (ns === "od") return orderAction(i, act, arg);
  return null;
}

async function salesPicker(i: any) {
  if (!isAdmin(i)) return eph("Só administradores podem usar isso.");
  const { data: ps } = await db.from("products").select("id,name").eq("active", true).order("created_at").limit(25);
  if (!ps?.length) return eph("Cadastre produtos no painel web antes de criar um painel de vendas.", "warn");
  return J({ type: 4, data: { flags: 64, embeds: [note("Escolha os produtos deste painel.")], components: [select("vp:create", ps.map((p) => ({ label: p.name.slice(0, 100), value: p.id })), { min_values: 1, max_values: ps.length, placeholder: "Produtos" })] } });
}

async function publishPanel(i: any) {
  if (!isAdmin(i)) return eph("Só administradores podem usar isso.");
  const ids: string[] = i.data.values ?? [];
  const { data: panel } = await db.from("sales_panels").insert({ guild_id: i.guild_id, channel_id: i.channel_id }).select().single();
  if (!panel) throw new Error("panel");
  await db.from("panel_products").insert(ids.map((product_id) => ({ panel_id: panel.id, product_id })));
  const { data: ps } = await db.from("products").select("id,name").in("id", ids).eq("active", true);
  const m = await say(i.channel_id, {
    embeds: [{ title: "Loja", description: "Escolha um produto no menu.", color: C.main }],
    components: [select(`vp:pick:${panel.id}`, (ps ?? []).map((p) => ({ label: p.name.slice(0, 100), value: p.id })), { placeholder: "Escolha um produto" })],
  });
  await db.from("sales_panels").update({ message_id: m.id }).eq("id", panel.id);
  return eph("Painel publicado ✓ Para mudar os produtos, use o painel web.", "ok");
}

async function pickProduct(i: any, panelId: string) {
  const productId = i.data.values?.[0];
  const { data: pn } = await db.from("sales_panels").select("active").eq("id", panelId).maybeSingle();
  if (!pn?.active) return eph("Este painel está desativado.", "warn");
  const { data: link } = await db.from("panel_products").select("product_id").eq("panel_id", panelId).eq("product_id", productId).maybeSingle();
  const { data: p } = link ? await db.from("products").select("*, product_variants(*)").eq("id", productId).maybeSingle() : { data: null };
  const vars = (p?.product_variants ?? []).filter((v: any) => v.available);
  if (!p || !p.active || !vars.length) return eph("Este produto está indisponível no momento.", "warn");
  return J({ type: 4, data: { flags: 64,
    embeds: [{ title: p.name, description: p.description ?? undefined, color: C.main, thumbnail: p.image_url ? { url: p.image_url } : undefined }],
    components: [select(`vp:var:${p.id}`, vars.slice(0, 25).map((v: any) => ({ label: `${v.name} · ${brl(v.price_cents)}`.slice(0, 100), value: v.id })), { placeholder: "Escolha o plano" })],
  } });
}

async function createOrder(i: any) {
  const g = i.guild_id, u = uid(i);
  const cfg = await getCfg(g);
  if (!cfg?.orders_channel_id) return void (await edit(i, { embeds: [note("A loja ainda não está configurada. Avise a equipe.", "warn")] }));
  const { data: v } = await db.from("product_variants").select("*, products(name,active)").eq("id", i.data.values[0]).maybeSingle();
  if (!v || !v.available || !v.products?.active) return void (await edit(i, { embeds: [note("Este plano está indisponível no momento.", "warn")] }));

  const expires = new Date(Date.now() + (cfg.order_expire_minutes ?? 30) * 60000).toISOString();
  const { data: o, error } = await db.from("orders").insert({
    guild_id: g, user_id: u, variant_id: v.id, product_name: v.products.name,
    variant_name: v.name, price_cents: v.price_cents, expires_at: expires,
  }).select().single();
  if (error || !o) {
    if (error?.code === "23505") {
      const { data: ex } = await db.from("orders").select().eq("user_id", u).eq("variant_id", v.id).eq("status", "pending").maybeSingle();
      if (ex) return void (await edit(i, { embeds: [note("Você já tem um pedido pendente deste plano.", "warn"), invoiceEmbed(ex, cfg, ex.pix_payload)] }));
    }
    throw error;
  }

  const pix = await createPixCharge({ orderId: o.id, amountCents: o.price_cents }).catch((e) => { console.error("pix", e); return null; });
  if (pix) { await db.from("orders").update({ pix_charge_id: pix.chargeId, pix_payload: pix.payload }).eq("id", o.id); o.pix_charge_id = pix.chargeId; }
  const m = await say(cfg.orders_channel_id, { embeds: [orderEmbed(o)], components: orderButtons(o) });
  await db.from("orders").update({ staff_channel_id: cfg.orders_channel_id, staff_message_id: m.id }).eq("id", o.id);
  await db.from("order_events").insert({ order_id: o.id, type: "created", actor: u });
  await logEvent(g, { action: "Pedido criado", ref: `Pedido #${o.number}`, client: `<@${u}>`, result: `${brl(o.price_cents)} · aguardando pagamento`, kind: "warn" });
  await edit(i, { embeds: [invoiceEmbed(o, cfg, pix?.payload)] });
}

const FLOW: Record<string, { from: string; to: string; col?: string }> = {
  paid: { from: "pending", to: "paid", col: "paid_at" },
  deliver: { from: "paid", to: "delivered", col: "delivered_at" },
  cancel: { from: "pending", to: "cancelled" },
};

async function orderAction(i: any, act: string, orderId: string) {
  const cfg = await getCfg(i.guild_id);
  if (!isStaff(i, cfg)) return eph("Só a equipe pode alterar pedidos.");
  const f = FLOW[act];
  if (!f) return eph("Essa ação não está disponível.");
  const { data: o } = await db.from("orders").update({ status: f.to, handled_by: uid(i), ...(f.col ? { [f.col]: new Date().toISOString() } : {}) })
    .eq("id", orderId).eq("status", f.from).select().maybeSingle();
  if (!o) return eph("Este pedido já mudou de status.", "warn");
  await db.from("order_events").insert({ order_id: o.id, type: f.to, actor: uid(i) });
  after(() => afterOrderChange(o, `<@${uid(i)}>`, false));
  return J({ type: 7, data: { embeds: [orderEmbed(o)], components: orderButtons(o) } });
}
