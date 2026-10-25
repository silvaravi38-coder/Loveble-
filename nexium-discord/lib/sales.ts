/* eslint-disable @typescript-eslint/no-explicit-any */
import { after } from "next/server";
import { db } from "@/lib/db";
import { C } from "@/lib/discord";
import { createPixCharge } from "@/lib/pix";
import { afterOrderChange, brl, invoiceEmbed, orderButtons, orderEmbed } from "@/lib/orders";
import { finishDelivery, handleReview, onOrderChange, sendDelivery } from "@/lib/lifecycle";
import { logEvent, note } from "@/lib/embeds";
import { button, edit, eph, fields, getCfg, input, isAdmin, isStaff, J, modalOf, row, say, select, uid } from "@/lib/ix";

export async function handleSales(i: any) {
  const id = String(i.data?.custom_id ?? "");
  const [ns, act, arg] = id.split(":");
  if (id === "cfg:sales") return salesPicker(i);
  if (ns === "rv") return handleReview(i);
  if (ns === "vp") {
    if (act === "create") return publishPanel(i);
    if (act === "pick") return pickProduct(i, arg);
    if (act === "quick") return productReply(i, arg);
    if (act === "var") return confirmPlan(i);
    if (act === "buy") return startOrder(i, arg);
    if (act === "cupom") return modalOf(`vp:cupom:${arg}`, "Cupom de desconto", [input("code", "Código do cupom", { max: 30, placeholder: "Ex.: BEMVINDO10" })]);
  }
  if (ns === "od") return orderAction(i, act, arg);
  return null;
}

export function couponSubmit(i: any) {
  const customId = String(i.data?.custom_id ?? "");
  if (!customId.startsWith("vp:cupom:")) return null;
  const variantId = customId.split(":")[2];
  const code = fields(i).code;
  return startOrder(i, variantId, code);
}

function startOrder(i: any, variantId: string, code?: string) {
  after(() => createOrder(i, variantId, code).catch(async (error) => {
    console.error("order", error);
    await edit(i, { embeds: [note("Não foi possível criar o pedido agora. Tente novamente.", "err")] }).catch(() => {});
  }));
  return J({ type: 5, data: { flags: 64 } });
}

async function salesPicker(i: any) {
  if (!isAdmin(i)) return eph("Só administradores podem criar painéis de venda.");
  const { data: products } = await db.from("products").select("id,name").eq("active", true).order("created_at").limit(25);
  if (!products?.length) return eph("Cadastre produtos antes de criar um painel de vendas.", "warn");
  return J({ type: 4, data: { flags: 64, embeds: [note("Escolha os produtos deste painel.")], components: [select("vp:create", products.map((p) => ({ label: p.name.slice(0, 100), value: p.id })), { min_values: 1, max_values: products.length, placeholder: "Produtos" })] } });
}

async function publishPanel(i: any) {
  if (!isAdmin(i)) return eph("Só administradores podem criar painéis de venda.");
  const ids = [...new Set<string>((i.data.values ?? []).map((value: unknown) => String(value)))];
  if (!ids.length || ids.length > 25) return eph("Escolha de 1 a 25 produtos.", "warn");
  const { data: products } = await db.from("products").select("id,name").in("id", ids).eq("active", true);
  if (!products?.length) return eph("Os produtos escolhidos não estão ativos.", "warn");
  const { data: panel, error } = await db.from("sales_panels").insert({ guild_id: i.guild_id, channel_id: i.channel_id }).select().single();
  if (error || !panel) throw error ?? new Error("Não foi possível criar o painel.");
  try {
    const { error: linkError } = await db.from("panel_products").insert(products.map((p) => ({ panel_id: panel.id, product_id: p.id })));
    if (linkError) throw linkError;
    const message = await say(i.channel_id, {
      embeds: [{ title: "Loja", description: "Escolha um produto para ver os planos.", color: C.main }],
      components: [select(`vp:pick:${panel.id}`, products.map((p) => ({ label: p.name.slice(0, 100), value: p.id })), { placeholder: "Escolha um produto" })],
    });
    const { error: updateError } = await db.from("sales_panels").update({ message_id: message.id }).eq("id", panel.id);
    if (updateError) throw updateError;
  } catch (error) {
    await db.from("sales_panels").delete().eq("id", panel.id);
    throw error;
  }
  return eph("Painel publicado.", "ok");
}

async function usableVariants(product: any) {
  const variants = (product.product_variants ?? []).filter((v: any) => v.available);
  const automatic = variants.filter((v: any) => v.auto_delivery).map((v: any) => v.id);
  const counts: Record<string, number> = {};
  if (automatic.length) {
    const { data, error } = await db.rpc("stock_counts", { p_variants: automatic });
    if (error) throw error;
    for (const row of data ?? []) counts[row.variant_id] = Number(row.n);
  }
  return variants.filter((v: any) => !v.auto_delivery || (counts[v.id] ?? 0) > 0);
}

async function productReply(i: any, productId: string) {
  const { data: product } = await db.from("products").select("*, product_variants(*)").eq("id", productId).maybeSingle();
  const variants = product?.active ? await usableVariants(product) : [];
  if (!product || !variants.length) return eph("Este produto está indisponível no momento.", "warn");
  return J({ type: 4, data: { flags: 64,
    embeds: [{ title: product.name, description: product.description ?? undefined, color: C.main, thumbnail: product.image_url ? { url: product.image_url } : undefined }],
    components: [select(`vp:var:${product.id}`, variants.slice(0, 25).map((v: any) => ({ label: `${v.name} · ${brl(v.price_cents)}`.slice(0, 100), value: v.id })), { placeholder: "Escolha o plano" })],
  } });
}

async function pickProduct(i: any, panelId: string) {
  const productId = i.data.values?.[0];
  const { data: panel } = await db.from("sales_panels").select("guild_id,active").eq("id", panelId).maybeSingle();
  if (!panel?.active || panel.guild_id !== i.guild_id) return eph("Este painel está indisponível.", "warn");
  const { data: link } = await db.from("panel_products").select("product_id").eq("panel_id", panelId).eq("product_id", productId).maybeSingle();
  if (!link) return eph("Este produto não faz parte deste painel.", "warn");
  return productReply(i, productId);
}

async function confirmPlan(i: any) {
  const variantId = i.data.values?.[0];
  const { data: variant } = await db.from("product_variants").select("*, products(id,name,active)").eq("id", variantId).maybeSingle();
  if (!variant || !variant.available || !variant.products?.active) return eph("Este plano está indisponível no momento.", "warn");
  if (variant.auto_delivery) {
    const { data: counts, error } = await db.rpc("stock_counts", { p_variants: [variant.id] });
    if (error) throw error;
    if (!Number(counts?.[0]?.n ?? 0)) return eph("Este plano está sem estoque no momento.", "warn");
  }
  const cfg = await getCfg(i.guild_id);
  return J({ type: 7, data: {
    embeds: [{ title: variant.products.name, color: C.main, fields: [
      { name: "Plano", value: variant.name, inline: true },
      { name: "Valor", value: brl(variant.price_cents), inline: true },
      { name: "Entrega", value: variant.auto_delivery ? "Automática por DM após a confirmação do pagamento" : (cfg?.delivery_note ?? "Feita pela equipe") },
    ] }],
    components: [row(button("Comprar", `vp:buy:${variant.id}`, 3), button("Tenho cupom", `vp:cupom:${variant.id}`, 2))],
  } });
}

async function createOrder(i: any, variantId: string, code?: string) {
  const guildId = i.guild_id, userId = uid(i);
  if (!guildId || !userId) return void (await edit(i, { embeds: [note("Faça o pedido dentro do servidor.", "warn")] }));
  const cfg = await getCfg(guildId);
  if (!cfg?.orders_channel_id) return void (await edit(i, { embeds: [note("A loja ainda não está configurada. Avise a equipe.", "warn")] }));
  const { data: variant } = await db.from("product_variants").select("*, products(name,active)").eq("id", variantId).maybeSingle();
  if (!variant || !variant.available || !variant.products?.active) return void (await edit(i, { embeds: [note("Este plano está indisponível no momento.", "warn")] }));
  if (variant.auto_delivery) {
    const { data: counts, error } = await db.rpc("stock_counts", { p_variants: [variant.id] });
    if (error) throw error;
    if (!Number(counts?.[0]?.n ?? 0)) return void (await edit(i, { embeds: [note("Este plano está sem estoque no momento.", "warn")] }));
  }
  const expires = new Date(Date.now() + Number(cfg.order_expire_minutes ?? 30) * 60000).toISOString();
  const { data: rows, error } = await db.rpc("create_order_atomic", {
    p_guild: guildId, p_user: userId, p_variant: variant.id,
    p_product_name: variant.products.name, p_variant_name: variant.name,
    p_price_cents: variant.price_cents, p_expires: expires, p_code: code?.trim() || null,
  });
  const order = rows?.[0];
  if (error || !order) {
    if (error?.code === "23505") {
      const { data: existing } = await db.from("orders").select().eq("guild_id", guildId).eq("user_id", userId).eq("variant_id", variant.id).eq("status", "pending").maybeSingle();
      if (existing) return void (await edit(i, { embeds: [note("Você já tem um pedido pendente deste plano.", "warn"), invoiceEmbed(existing, cfg, existing.pix_payload)] }));
    }
    if (error?.message?.includes("COUPON_INVALID")) return void (await edit(i, { embeds: [note("Cupom inválido, expirado ou esgotado.", "warn")] }));
    throw error ?? new Error("Não foi possível criar o pedido.");
  }

  const pix = await createPixCharge({ orderId: order.id, amountCents: order.price_cents }).catch((e) => { console.error("pix", e); return null; });
  if (pix) {
    const { data: updated, error: pixError } = await db.from("orders").update({ pix_charge_id: pix.chargeId, pix_payload: pix.payload }).eq("id", order.id).select().single();
    if (pixError) console.error("save pix charge", pixError.message);
    else Object.assign(order, updated);
  }
  const message = await say(cfg.orders_channel_id, { embeds: [orderEmbed(order)], components: orderButtons(order) });
  await db.from("orders").update({ staff_channel_id: cfg.orders_channel_id, staff_message_id: message.id }).eq("id", order.id);
  await db.from("order_events").insert({ order_id: order.id, type: "created", actor: userId });
  await logEvent(guildId, { action: "Pedido criado", ref: `Pedido #${order.number}`, client: `<@${userId}>`, result: `${brl(order.price_cents)} · aguardando pagamento`, kind: "warn" });
  await edit(i, { embeds: [invoiceEmbed(order, cfg, pix?.payload)] });
}

const FLOW: Record<string, { from: string; to: string; col?: string }> = {
  paid: { from: "pending", to: "paid", col: "paid_at" },
  deliver: { from: "paid", to: "delivered", col: "delivered_at" },
  cancel: { from: "pending", to: "cancelled" },
};

async function orderAction(i: any, action: string, orderId: string) {
  const guildId = i.guild_id, actorId = uid(i);
  const cfg = await getCfg(guildId);
  if (!isStaff(i, cfg)) return eph("Só a equipe pode alterar pedidos.");
  if (action === "resend") {
    const { data: order } = await db.from("orders").select().eq("id", orderId).eq("guild_id", guildId).maybeSingle();
    const { data: item } = order?.stock_item_id ? await db.from("stock_items").select("id,content,status,order_id").eq("id", order.stock_item_id).maybeSingle() : { data: null };
    if (!order || order.status !== "paid" || !item || item.order_id !== order.id || item.status !== "reserved") return eph("Não há uma entrega automática pendente para reenviar.", "warn");
    if (!(await sendDelivery(order, item.content))) return eph("Não consegui enviar por DM. Peça ao cliente para liberar mensagens privadas.", "warn");
    await finishDelivery(order.id, item.id);
    return eph("Entrega reenviada.", "ok");
  }
  const flow = FLOW[action];
  if (!flow) return eph("Essa ação não está disponível.");
  const { data: order } = await db.from("orders").update({ status: flow.to, handled_by: actorId, ...(flow.col ? { [flow.col]: new Date().toISOString() } : {}) })
    .eq("id", orderId).eq("guild_id", guildId).eq("status", flow.from).select().maybeSingle();
  if (!order) return eph("Este pedido já mudou de status.", "warn");
  await db.from("order_events").insert({ order_id: order.id, type: flow.to, actor: actorId });
  after(() => onOrderChange(order, `<@${actorId}>`, false).catch((e) => console.error("order lifecycle", e)));
  return J({ type: 7, data: { embeds: [orderEmbed(order)], components: orderButtons(order) } });
}

export { afterOrderChange };
