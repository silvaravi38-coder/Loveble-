/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { api } from "@/lib/discord";
import { COLOR, dmTry, logEvent } from "@/lib/embeds";
import { afterOrderChange, refreshOrderMessage } from "@/lib/orders";
import { J } from "@/lib/ix";

export async function onOrderChange(order: any, staffLabel: string, refresh = true) {
  await afterOrderChange(order, staffLabel, refresh);
  if ((order.status === "cancelled" || order.status === "expired") && order.coupon_id) {
    const { error } = await db.rpc("release_coupon", { p_order: order.id });
    if (error) console.error("coupon release", error.message);
  }
  if (order.status === "paid") {
    await giveCustomerRole(order);
    await autoDeliver(order);
  }
  if (order.status === "delivered") await askReview(order);
}

async function giveCustomerRole(order: any) {
  const { data: cfg } = await db.from("discord_settings").select("customer_role_id").eq("guild_id", order.guild_id).maybeSingle();
  if (!cfg?.customer_role_id) return;
  try {
    await api("PUT", `/guilds/${order.guild_id}/members/${order.user_id}/roles/${cfg.customer_role_id}`);
  } catch {
    await logEvent(order.guild_id, { action: "Não consegui dar o cargo Cliente", ref: `Pedido #${order.number}`, client: `<@${order.user_id}>`, result: "Confira o cargo do bot e a permissão Gerenciar cargos", kind: "warn" });
  }
}

export function sendDelivery(order: any, content: string) {
  const safe = content.replaceAll("```", "'''").slice(0, 3800);
  return dmTry(order.user_id, { embeds: [{
    title: `Seu produto · Pedido #${order.number}`, color: COLOR.ok,
    description: `\`\`\`\n${safe}\n\`\`\``,
    fields: [{ name: "Produto", value: `${order.product_name} · ${order.variant_name}`.slice(0, 1024) }],
  }] });
}

// Só confirma a entrega se o pedido ainda estiver pago e o item estiver reservado para ele.
export async function finishDelivery(orderId: string, itemId: string) {
  const now = new Date().toISOString();
  const { data: order, error } = await db.from("orders").update({ status: "delivered", delivered_at: now, handled_by: "auto" })
    .eq("id", orderId).eq("status", "paid").eq("stock_item_id", itemId).select().maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const { error: stockError } = await db.from("stock_items").update({ status: "delivered", delivered_at: now })
    .eq("id", itemId).eq("order_id", orderId).eq("status", "reserved");
  if (stockError) console.error("stock finalize", stockError.message);
  await db.from("order_events").insert({ order_id: orderId, type: "delivered", actor: "auto" });
  await refreshOrderMessage(order);
  await logEvent(order.guild_id, { action: "Pedido entregue (automático)", ref: `Pedido #${order.number}`, client: `<@${order.user_id}>`, staff: "Automático", result: "Entregue", kind: "ok" });
  await askReview(order);
  return order;
}

async function autoDeliver(order: any) {
  const { data: variant, error } = await db.from("product_variants").select("auto_delivery, low_stock_alert").eq("id", order.variant_id).maybeSingle();
  if (error || !variant?.auto_delivery) return;
  const { data: rows, error: claimError } = await db.rpc("claim_stock", { p_variant: order.variant_id, p_order: order.id });
  if (claimError) {
    console.error("stock claim", claimError.message);
    await logEvent(order.guild_id, { action: "Falha ao reservar estoque", ref: `Pedido #${order.number}`, client: `<@${order.user_id}>`, result: "A equipe precisa verificar a entrega", kind: "err" });
    return;
  }
  const item = rows?.[0];
  if (!item) {
    await logEvent(order.guild_id, { action: "Sem estoque para entrega automática", ref: `Pedido #${order.number}`, client: `<@${order.user_id}>`, result: "A equipe fará a entrega manualmente", kind: "warn" });
    return;
  }
  if (!(await sendDelivery(order, item.content))) {
    const { data: fresh } = await db.from("orders").select().eq("id", order.id).maybeSingle();
    if (fresh) await refreshOrderMessage(fresh);
    await logEvent(order.guild_id, { action: "Entrega automática não enviada", ref: `Pedido #${order.number}`, client: `<@${order.user_id}>`, result: "DM fechada; a equipe pode reenviar", kind: "warn" });
    return;
  }
  const delivered = await finishDelivery(order.id, item.id);
  if (!delivered) return;
  const { data: countRows } = await db.rpc("stock_counts", { p_variants: [order.variant_id] });
  const count = Number(countRows?.[0]?.n ?? 0);
  if (count <= Number(variant.low_stock_alert ?? 3)) {
    await logEvent(order.guild_id, { action: "Estoque baixo", ref: `${order.product_name} · ${order.variant_name}`, result: `${count} restantes`, kind: "warn" });
  }
}

async function askReview(order: any) {
  const { data: existing } = await db.from("reviews").select("order_id").eq("order_id", order.id).maybeSingle();
  if (existing) return;
  await dmTry(order.user_id, {
    embeds: [{ title: "Como foi sua compra?", description: `Pedido #${order.number} · ${order.product_name}. Escolha uma nota.`, color: COLOR.main }],
    components: [{ type: 1, components: [1, 2, 3, 4, 5].map((rating) => ({ type: 2, style: 2, label: "★".repeat(rating), custom_id: `rv:${order.id}:${rating}` })) }],
  });
}

export async function handleReview(interaction: any) {
  const [, orderId, ratingText] = String(interaction.data?.custom_id ?? "").split(":");
  const rating = Number(ratingText);
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5 || !userId) return null;
  const { data: order } = await db.from("orders").select("id,guild_id,user_id,product_name,status").eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== userId || order.status !== "delivered") return J({ type: 4, data: { flags: 64, content: "Este pedido não está disponível para avaliação." } });
  const { error } = await db.from("reviews").upsert({ order_id: orderId, guild_id: order.guild_id, user_id: userId, rating }, { onConflict: "order_id" });
  if (error) throw error;
  const { data: cfg } = await db.from("discord_settings").select("reviews_channel_id").eq("guild_id", order.guild_id).maybeSingle();
  if (cfg?.reviews_channel_id) {
    await api("POST", `/channels/${cfg.reviews_channel_id}/messages`, {
      embeds: [{ title: "Nova avaliação", description: `${"★".repeat(rating)}${"☆".repeat(5 - rating)} · ${order.product_name}`, color: COLOR.main, footer: { text: `Pedido #${orderId.slice(0, 8)}` } }],
      allowed_mentions: { parse: [] },
    }).catch(() => {});
  }
  return J({ type: 7, data: { embeds: [{ title: "Obrigado pela avaliação!", description: `Sua nota: ${"★".repeat(rating)}`, color: COLOR.ok }], components: [] } });
}
