import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { btn, card, inp, ghost } from "@/lib/ui";
import { parsePrice } from "@/lib/ix";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function createCoupon(fd: FormData) {
  "use server";
  await requireAdmin();
  const code = str(fd, "code").toUpperCase();
  const kind = str(fd, "kind");
  const guildId = str(fd, "guild_id");
  const limit = str(fd, "max_uses") ? Number(str(fd, "max_uses")) : null;
  const { data: cfg } = await db.from("discord_settings").select("guild_id").eq("guild_id", guildId).maybeSingle();
  if (!cfg || !/^[A-Z0-9_-]{3,30}$/.test(code) || (limit !== null && (!Number.isInteger(limit) || limit < 1))) redirect("/admin/coupons?erro=validacao");
  const discount = kind === "percent" ? Number(str(fd, "discount")) : parsePrice(str(fd, "discount"));
  if (discount === null || !Number.isFinite(discount) || (kind === "percent" ? discount < 1 || discount > 100 : discount <= 0)) redirect("/admin/coupons?erro=valor");
  const expiresRaw = str(fd, "expires_at");
  const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;
  const { error } = await db.from("coupons").insert({
    guild_id: guildId, code, percent: kind === "percent" ? discount : null,
    amount_cents: kind === "fixed" ? discount : null, max_uses: limit, expires_at: expiresAt,
  });
  redirect(error ? "/admin/coupons?erro=duplicado" : "/admin/coupons?ok=1");
}

async function toggleCoupon(fd: FormData) {
  "use server";
  await requireAdmin();
  const id = str(fd, "id"), current = str(fd, "active") === "true";
  await db.from("coupons").update({ active: !current }).eq("id", id);
  redirect("/admin/coupons?ok=1");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const [{ data: cfg }, { data: coupons }] = await Promise.all([
    db.from("discord_settings").select("guild_id").limit(1).maybeSingle(),
    db.from("coupons").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  const money = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
  return <>
    <h1 className="text-2xl font-semibold">Cupons</h1>
    {q.ok && <p className={`${card} text-[#00FF7F]`}>Salvo.</p>}
    {q.erro && <p className={`${card} text-[#FF4B4B]`}>Confira o código, o desconto e se a migration 007 foi executada. O código precisa ser único.</p>}
    {!cfg ? <p className="text-white/60">Rode /config no servidor primeiro.</p> : <details className={card}>
      <summary className="cursor-pointer font-medium">Criar cupom</summary>
      <form action={createCoupon} className="mt-3 space-y-3">
        <input type="hidden" name="guild_id" value={cfg.guild_id} />
        <input name="code" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_-]+" placeholder="Código (ex.: BEMVINDO10)" className={inp} />
        <select name="kind" className={inp} defaultValue="percent"><option value="percent">Desconto em porcentagem</option><option value="fixed">Desconto em reais</option></select>
        <input name="discount" required inputMode="decimal" placeholder="Desconto (ex.: 10 ou 5,00)" className={inp} />
        <input name="max_uses" type="number" min={1} placeholder="Limite de usos (opcional)" className={inp} />
        <label className="block text-sm text-white/60">Validade (opcional)<input name="expires_at" type="datetime-local" className={`${inp} mt-1`} /></label>
        <button className={btn}>Criar cupom</button>
      </form>
    </details>}
    {!coupons?.length ? <p className="text-white/60">Nenhum cupom cadastrado.</p> : coupons.map((c) => <article key={c.id} className={`${card} flex items-center justify-between gap-3`}>
      <div><b>{c.code}</b><div className="text-sm text-white/60">{c.percent ? `${c.percent}%` : money(c.amount_cents)} · {c.uses}{c.max_uses ? `/${c.max_uses}` : " usos"} · {c.active ? "Ativo" : "Pausado"}</div></div>
      <form action={toggleCoupon}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(c.active)} /><button className={ghost}>{c.active ? "Pausar" : "Ativar"}</button></form>
    </article>)}
  </>;
}
