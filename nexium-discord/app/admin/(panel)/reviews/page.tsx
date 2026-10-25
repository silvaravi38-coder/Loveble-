import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { card } from "@/lib/ui";

export default async function Page() {
  await requireAdmin();
  const { data: reviews } = await db.from("reviews").select("*, orders(number,product_name,variant_name)").order("created_at", { ascending: false }).limit(100);
  const average = reviews?.length ? (reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length).toFixed(1) : "—";
  return <>
    <h1 className="text-2xl font-semibold">Avaliações</h1>
    <section className={card}><span className="text-sm text-white/60">Média geral</span><div className="text-2xl font-semibold">{average} ★ <span className="text-sm text-white/50">({reviews?.length ?? 0})</span></div></section>
    {!reviews?.length ? <p className="text-white/60">Nenhuma avaliação ainda.</p> : reviews.map((r: any) => <article key={r.order_id} className={`${card} space-y-1`}>
      <div className="flex justify-between gap-3"><b>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</b><span className="text-sm text-white/50">{new Date(r.created_at).toLocaleDateString("pt-BR")}</span></div>
      <p>{r.orders?.product_name ?? "Produto"} · Pedido #{r.orders?.number ?? r.order_id.slice(0, 8)}</p>
      <p className="text-sm text-white/50">Cliente {r.user_id}</p>
    </article>)}
  </>;
}
