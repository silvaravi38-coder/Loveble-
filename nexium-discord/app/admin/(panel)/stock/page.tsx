import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { btn, card, inp } from "@/lib/ui";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function addStock(fd: FormData) {
  "use server";
  await requireAdmin();
  const variantId = str(fd, "variant_id");
  const items = str(fd, "items").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!variantId || !items.length || items.length > 200 || items.some((x) => x.length > 4000)) redirect("/admin/stock?erro=validacao");
  const { data: variant } = await db.from("product_variants").select("id").eq("id", variantId).maybeSingle();
  if (!variant) redirect("/admin/stock?erro=plano");
  const { error } = await db.from("stock_items").insert(items.map((content) => ({ variant_id: variantId, content })));
  redirect(error ? "/admin/stock?erro=salvar" : `/admin/stock?ok=${items.length}`);
}

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const { data: variants } = await db.from("product_variants").select("id,name,products!inner(id,name,active)").eq("products.active", true).order("created_at", { ascending: false }).limit(500);
  const ids = variants?.map((v) => v.id) ?? [];
  const { data: counts } = ids.length ? await db.rpc("stock_counts", { p_variants: ids }) : { data: [] };
  const available = new Map<string, number>((counts ?? []).map((x: any) => [String(x.variant_id), Number(x.n)] as [string, number]));
  const active = variants ?? [];
  return <>
    <h1 className="text-2xl font-semibold">Estoque para entrega automática</h1>
    <p className="text-sm text-white/60">Adicione um item por linha. O conteúdo fica somente no servidor e é enviado ao cliente por DM depois que a equipe confirma o pagamento.</p>
    {q.ok && <p className={`${card} text-[#00FF7F]`}>{q.ok} item(ns) adicionados.</p>}
    {q.erro && <p className={`${card} text-[#FF4B4B]`}>Não foi possível salvar. Confira o plano e se a migration 007 foi executada.</p>}
    {!active.length ? <p className="text-white/60">Cadastre um produto e um plano primeiro.</p> : <form action={addStock} className={`${card} space-y-3`}>
      <label className="block text-sm text-white/60">Produto e plano
        <select name="variant_id" required defaultValue="" className={`${inp} mt-1`}>
          <option value="" disabled>Escolha…</option>
          {active.map((v: any) => <option key={v.id} value={v.id}>{v.products.name} · {v.name}</option>)}
        </select>
      </label>
      <label className="block text-sm text-white/60">Um código/entrega por linha (máximo 200)
        <textarea name="items" required maxLength={500000} rows={8} className={`${inp} mt-1`} placeholder={'login:senha\nchave ou código de entrega'} />
      </label>
      <button className={btn}>Adicionar ao estoque</button>
    </form>}
    <section className={`${card} space-y-2`}>
      <h2 className="font-semibold">Estoque disponível</h2>
      {active.map((v: any) => <div key={v.id} className="flex justify-between gap-3 border-t border-white/10 pt-2 text-sm">
        <span>{v.products.name} · {v.name}</span><b>{available.get(v.id) ?? 0}</b>
      </div>)}
    </section>
  </>;
}
