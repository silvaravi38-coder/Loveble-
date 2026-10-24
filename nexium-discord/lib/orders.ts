/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from "@/lib/discord";
import { COLOR, dm, logEvent, type Kind } from "@/lib/embeds";

export const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
export const STATUS_PT: Record<string, string> = {
  pending: "Aguardando pagamento", paid: "Pagamento confirmado", delivered: "Entregue", cancelled: "Cancelado", expired: "Expirado",
};
const KIND: Record<string, Kind> = { pending: "warn", paid: "ok", delivered: "main", cancelled: "err", expired: "err" };
const payment = (o: any) => (o.pix_charge_id ? "Pix (cobrança automática)" : "Pix (manual)");
const who = (h?: string | null) => (!h ? null : h.startsWith("web:") ? "Painel web" : `<@${h}>`);

// Mensagem da equipe: dados do pedido, status e atendente.
export const orderEmbed = (o: any) => ({
  title: `Pedido #${o.number}`,
  color: COLOR[KIND[o.status]],
  fields: [
    { name: "Produto", value: o.product_name, inline: true },
    { name: "Plano", value: o.variant_name, inline: true },
    { name: "Valor", value: brl(o.price_cents), inline: true },
    { name: "Cliente", value: `<@${o.user_id}>`, inline: true },
    { name: "Pagamento", value: payment(o), inline: true },
    { name: "Status", value: STATUS_PT[o.status], inline: true },
    ...(who(o.handled_by) ? [{ name: "Atendente", value: who(o.handled_by)!, inline: true }] : []),
  ],
  timestamp: new Date(o.created_at).toISOString(),
});

// Só as ações válidas para o status atual.
export const orderButtons = (o: any) =>
  o.status === "pending"
    ? [{ type: 1, components: [
        { type: 2, style: 3, label: "Confirmar pagamento", custom_id: `od:paid:${o.id}` },
        { type: 2, style: 4, label: "Cancelar", custom_id: `od:cancel:${o.id}` },
      ] }]
    : o.status === "paid"
    ? [{ type: 1, components: [{ type: 2, style: 1, label: "Marcar como entregue", custom_id: `od:deliver:${o.id}` }] }]
    : [];

// Fatura do cliente.
export function invoiceEmbed(o: any, cfg: any, payload?: string | null) {
  const fields: any[] = [
    { name: "Produto", value: o.product_name, inline: true },
    { name: "Plano", value: o.variant_name, inline: true },
    { name: "Valor", value: brl(o.price_cents), inline: true },
    { name: "Pagamento", value: payload ? "Pix (copia e cola)" : "Pix", inline: true },
    { name: "Status", value: STATUS_PT[o.status], inline: true },
  ];
  if (payload) fields.push({ name: "Código Pix", value: "```" + payload + "```" });
  else if (cfg?.manual_pix_key) fields.push({ name: "Chave Pix", value: "```" + cfg.manual_pix_key + "```" });
  else fields.push({ name: "Instruções", value: "A equipe enviará as instruções de pagamento." });
  fields.push({ name: "Próximas etapas", value: "1. Pague o valor exato.\n2. A equipe confirma.\n3. Você recebe o produto." });
  return { title: `Fatura · Pedido #${o.number}`, description: cfg?.delivery_note ?? undefined, color: COLOR.main, fields };
}

const NOTICE: Record<string, [string, Kind, string]> = {
  paid: ["Pagamento confirmado. A entrega segue o prazo da fatura.", "ok", "Pedido pago"],
  delivered: ["Pedido entregue. Qualquer dúvida, abra um ticket.", "ok", "Pedido entregue"],
  cancelled: ["Pedido cancelado.", "err", "Pedido cancelado"],
  expired: ["Pedido expirado. Faça um novo pedido quando quiser.", "warn", "Pedido expirado"],
};

// Chame depois de qualquer mudança de status (bot, painel web ou cron).
// refresh=false quando o próprio clique no Discord já atualizou a mensagem da equipe.
export async function afterOrderChange(o: any, staffLabel: string, refresh = true) {
  const n = NOTICE[o.status];
  if (!n) return;
  const tasks: Promise<unknown>[] = [
    dm(o.user_id, `Pedido #${o.number}: ${n[0]}`, n[1]),
    logEvent(o.guild_id, { action: n[2], ref: `Pedido #${o.number}`, client: `<@${o.user_id}>`, staff: staffLabel, result: STATUS_PT[o.status], kind: n[1] }),
  ];
  if (refresh && o.staff_channel_id && o.staff_message_id) {
    tasks.push(api("PATCH", `/channels/${o.staff_channel_id}/messages/${o.staff_message_id}`, { embeds: [orderEmbed(o)], components: orderButtons(o) }).catch(() => {}));
  }
  await Promise.allSettled(tasks);
}
