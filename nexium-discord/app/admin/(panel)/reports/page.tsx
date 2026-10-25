import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { card } from "@/lib/ui";

const PERIODS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };
const brl = (n: number) => `R$ ${(Number(n ?? 0) / 100).toFixed(2).replace(".", ",")}`;

export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const days = query.days && query.days in PERIODS ? query.days : "30";
  const { data: cfg } = await db.from("discord_settings").select("guild_id").limit(1).maybeSingle();
  if (!cfg) return <><h1 className="text-2xl font-semibold">Relatórios</h1><p className="text-white/60">Rode /config no servidor primeiro.</p></>;
  const since = new Date(Date.now() - PERIODS[days] * 86400000).toISOString();
  const [{ data: report }, { data: customers }] = await Promise.all([
    db.rpc("sales_report", { p_guild: cfg.guild_id, p_since: since }),
    db.rpc("top_customers", { p_guild: cfg.guild_id, p_limit: 10 }),
  ]);
  const stats = report ?? {};
  return <>
    <h1 className="text-2xl font-semibold">Relatórios de vendas</h1>
    <nav className="flex gap-2">{Object.keys(PERIODS).map((n) => <a key={n} href={`?days=${n}`} className={`rounded-lg border px-4 py-2 ${days === n ? "border-white bg-white text-black" : "border-white/10 text-white/70"}`}>{n} dias</a>)}</nav>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Faturamento", brl(stats.revenue)], ["Pedidos", stats.orders ?? 0], ["Pagos", stats.sold ?? 0], ["Pendentes", stats.pending ?? 0]].map(([name, value]) => <div key={name} className={card}><div className="text-sm text-white/60">{name}</div><div className="text-xl font-semibold">{value}</div></div>)}
    </div>
    <section className={`${card} space-y-2`}><h2 className="font-semibold">Produtos mais vendidos</h2>
      {!stats.top?.length ? <p className="text-sm text-white/50">Sem vendas no período.</p> : stats.top.map((p: any) => <div key={p.product} className="flex justify-between gap-3 border-t border-white/10 pt-2"><span>{p.product} · {p.n}</span><b>{brl(p.total)}</b></div>)}
    </section>
    <section className={`${card} space-y-2`}><h2 className="font-semibold">Maiores clientes</h2>
      {!customers?.length ? <p className="text-sm text-white/50">Sem vendas registradas.</p> : customers.map((c: any) => <div key={c.cust} className="flex justify-between gap-3 border-t border-white/10 pt-2"><span>{c.cust}</span><b>{brl(c.total)}</b></div>)}
    </section>
  </>;
}
