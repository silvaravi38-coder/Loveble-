import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { afterOrderChange, brl, STATUS_PT } from "@/lib/orders";
import { btn, card, ghost } from "@/lib/ui";

const FROM: Record<string, string> = { paid: "pending", delivered: "paid", cancelled: "pending" };

async function setStatus(fd: FormData) {
  "use server";
  const u = await requireAdmin();
  const to = String(fd.get("to")), id = String(fd.get("id")), from = FROM[to];
  if (!from) return;
  const col = to === "paid" ? "paid_at" : to === "delivered" ? "delivered_at" : null;
  const { data } = await db.from("orders").update({ status: to, handled_by: `web:${u.email ?? u.id}`, ...(col ? { [col]: new Date().toISOString() } : {}) })
    .eq("id", id).eq("status", from).select().maybeSingle();
  if (data) {
    await db.from("order_events").insert({ order_id: id, type: to, actor: `web:${u.id}` });
    await afterOrderChange(data, "Painel web", true); // atualiza a mensagem da equipe, avisa o cliente e registra no log
  }
  revalidatePath("/admin/orders");
}

function Act({ id, to, label, danger }: { id: string; to: string; label: string; danger?: boolean }) {
  return (
    <details>
      <summary className={`${ghost} flex cursor-pointer list-none items-center`}>{label}</summary>
      <form action={setStatus} className="mt-2">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={to} />
        <button className={`${btn} ${danger ? "!bg-[#FF4B4B]" : ""}`}>Confirmar: {label}</button>
      </form>
    </details>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  let q = db.from("orders").select().order("created_at", { ascending: false }).limit(50);
  if (status && STATUS_PT[status]) q = q.eq("status", status);
  const { data: orders } = await q;
  return (
    <>
      <h1 className="text-2xl font-semibold">Pedidos</h1>
      <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
        {[["", "Todos"], ...Object.entries(STATUS_PT)].map(([k, t]) => (
          <a key={k} href={k ? `?status=${k}` : "?"} className={`shrink-0 rounded-full border px-4 py-2 ${(status ?? "") === k ? "border-white bg-white text-black" : "border-white/10 text-white/70"}`}>{t}</a>
        ))}
      </div>
      {!orders?.length && <p className="text-white/60">Nenhum pedido encontrado.</p>}
      {orders?.map((o) => (
        <article key={o.id} className={`${card} space-y-2`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-semibold">#{o.number} · {o.product_name}</div><div className="text-sm text-white/60">{o.variant_name} · {brl(o.price_cents)}</div></div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-sm">{STATUS_PT[o.status]}</span>
          </div>
          <div className="text-sm text-white/50">Cliente {o.user_id} · {new Date(o.created_at).toLocaleString("pt-BR")}</div>
          <div className="flex flex-wrap gap-2">
            {o.status === "pending" && (<><Act id={o.id} to="paid" label="Confirmar pagamento" /><Act id={o.id} to="cancelled" label="Cancelar" danger /></>)}
            {o.status === "paid" && <Act id={o.id} to="delivered" label="Marcar como entregue" />}
          </div>
        </article>
      ))}
    </>
  );
}
