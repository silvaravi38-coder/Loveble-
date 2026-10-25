import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { btn, card, ghost, inp } from "@/lib/ui";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = () => revalidatePath("/admin/products");

async function createProduct(fd: FormData) {
  "use server";
  await requireAdmin();
  const name = str(fd, "name");
  const img = str(fd, "image_url");
  if (name.length < 2 || (img && !img.startsWith("https://"))) return;
  await db.from("products").insert({ name, description: str(fd, "description") || null, category: str(fd, "category") || null, image_url: img || null });
  done();
}
async function addVariant(fd: FormData) {
  "use server";
  await requireAdmin();
  const price = Number(str(fd, "price").replace(",", "."));
  const name = str(fd, "name");
  if (!name || !Number.isFinite(price) || price < 0) return;
  await db.from("product_variants").insert({ product_id: str(fd, "product_id"), name, price_cents: Math.round(price * 100) });
  done();
}
async function saveVariant(fd: FormData) {
  "use server";
  await requireAdmin();
  const price = Number(str(fd, "price").replace(",", "."));
  if (!Number.isFinite(price) || price < 0) return;
  const low = Number(str(fd, "low_stock_alert"));
  if (!Number.isInteger(low) || low < 0 || low > 100000) return;
  await db.from("product_variants").update({
    price_cents: Math.round(price * 100),
    available: fd.get("available") === "on",
    auto_delivery: fd.get("auto_delivery") === "on",
    low_stock_alert: low,
  }).eq("id", str(fd, "id"));
  done();
}
async function toggleProduct(fd: FormData) {
  "use server";
  await requireAdmin();
  await db.from("products").update({ active: str(fd, "active") !== "true" }).eq("id", str(fd, "id"));
  done();
}

export default async function Page() {
  await requireAdmin();
  const { data: products } = await db.from("products").select("*, product_variants(*)").order("created_at", { ascending: false });
  return (
    <>
      <h1 className="text-2xl font-semibold">Produtos</h1>
      <details className={card}>
        <summary className="cursor-pointer font-medium">Novo produto</summary>
        <form action={createProduct} className="mt-3 space-y-3">
          <input name="name" required placeholder="Nome" className={inp} />
          <input name="description" placeholder="Descrição curta" className={inp} />
          <input name="category" placeholder="Categoria" className={inp} />
          <input name="image_url" placeholder="URL da imagem (https://)" className={inp} />
          <button className={btn}>Criar produto</button>
        </form>
      </details>
      {!products?.length && <p className="text-white/60">Nenhum produto ainda.</p>}
      {products?.map((p) => (
        <section key={p.id} className={`${card} space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div><div className="font-semibold">{p.name}</div><div className="text-sm text-white/60">{p.active ? "Ativo" : "Arquivado"}{p.category ? ` · ${p.category}` : ""}</div></div>
            <form action={toggleProduct}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={String(p.active)} /><button className={ghost}>{p.active ? "Arquivar" : "Reativar"}</button></form>
          </div>
          {p.product_variants?.map((v: { id: string; name: string; price_cents: number; available: boolean; auto_delivery?: boolean; low_stock_alert?: number }) => (
            <form key={v.id} action={saveVariant} className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <input type="hidden" name="id" value={v.id} />
              <span className="w-24 shrink-0">{v.name}</span>
              <input name="price" defaultValue={(v.price_cents / 100).toFixed(2)} inputMode="decimal" className={`${inp} w-28`} aria-label={`Preço de ${v.name}`} />
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="available" defaultChecked={v.available} className="size-5" />Disponível</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="auto_delivery" defaultChecked={v.auto_delivery ?? false} className="size-5" />Entrega automática</label>
              <label className="flex min-h-11 items-center gap-2 text-sm">Avisar com
                <input name="low_stock_alert" type="number" min={0} max={100000} defaultValue={v.low_stock_alert ?? 3} className={`${inp} w-24`} aria-label={`Aviso de estoque baixo de ${v.name}`} />
              </label>
              <button className={ghost}>Salvar</button>
            </form>
          ))}
          <form action={addVariant} className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <input type="hidden" name="product_id" value={p.id} />
            <input name="name" required placeholder="Plano (ex.: 1 mês)" className={`${inp} w-40`} />
            <input name="price" required placeholder="Preço" inputMode="decimal" className={`${inp} w-28`} />
            <button className={btn}>Adicionar plano</button>
          </form>
        </section>
      ))}
    </>
  );
}
