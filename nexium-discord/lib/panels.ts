/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { api, C } from "@/lib/discord";

// Mensagem do painel de vendas, montada a partir do banco (só produtos ativos, até 25).
export async function panelPayload(panelId: string, name: string) {
  const { data: links } = await db.from("panel_products").select("products(id,name,active)").eq("panel_id", panelId);
  const ps = (links ?? []).map((l: any) => l.products).filter((p: any) => p?.active).slice(0, 25);
  return {
    embeds: [{ title: name, description: ps.length ? "Escolha um produto no menu." : "Nenhum produto disponível no momento.", color: C.main }],
    components: ps.length
      ? [{ type: 1, components: [{ type: 3, custom_id: `vp:pick:${panelId}`, placeholder: "Escolha um produto", options: ps.map((p: any) => ({ label: p.name.slice(0, 100), value: p.id })) }] }]
      : [],
  };
}

// Atualiza a mensagem já publicada. Retorna false se o painel não tem mensagem registrada.
export async function syncPanel(panel: any) {
  if (!panel.message_id) return false;
  const body = panel.active
    ? await panelPayload(panel.id, panel.name)
    : { embeds: [{ title: panel.name, description: "Painel indisponível no momento.", color: C.err }], components: [] };
  await api("PATCH", `/channels/${panel.channel_id}/messages/${panel.message_id}`, body);
  return true;
}
