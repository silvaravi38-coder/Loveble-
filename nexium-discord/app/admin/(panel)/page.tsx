import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { btn, card, inp } from "@/lib/ui";

async function save(fd: FormData) {
  "use server";
  await requireAdmin();
  await db.from("discord_settings").update({
    delivery_note: String(fd.get("delivery_note") ?? "").trim().slice(0, 200),
    manual_pix_key: String(fd.get("manual_pix_key") ?? "").trim().slice(0, 200) || null,
  }).eq("guild_id", String(fd.get("guild_id")));
  revalidatePath("/admin");
}

export default async function Page() {
  await requireAdmin();
  const [{ data: orders }, { count: open }, { data: cfg }] = await Promise.all([
    db.from("orders").select("status").limit(5000),
    db.from("tickets").select("id", { count: "exact", head: true }).neq("status", "closed"),
    db.from("discord_settings").select().limit(1).maybeSingle(),
  ]);
  const n = (s: string) => orders?.filter((o) => o.status === s).length ?? 0;
  const stats = [["Aguardando pagamento", n("pending")], ["Pagos", n("paid")], ["Entregues", n("delivered")], ["Tickets abertos", open ?? 0]];
  return (
    <>
      <h1 className="text-2xl font-semibold">Visão geral</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([t, v]) => (
          <div key={t} className={card}><div className="text-sm text-white/60">{t}</div><div className="text-2xl font-semibold">{v}</div></div>
        ))}
      </div>
      <section className={card}>
        <h2 className="mb-3 font-semibold">Loja</h2>
        {cfg ? (
          <form action={save} className="space-y-3">
            <input type="hidden" name="guild_id" value={cfg.guild_id} />
            <label className="block text-sm text-white/60">Mensagem de entrega
              <input name="delivery_note" defaultValue={cfg.delivery_note} className={`${inp} mt-1`} maxLength={200} />
            </label>
            <label className="block text-sm text-white/60">Chave Pix manual (opcional)
              <input name="manual_pix_key" defaultValue={cfg.manual_pix_key ?? ""} className={`${inp} mt-1`} maxLength={200} />
            </label>
            <button className={btn}>Salvar</button>
          </form>
        ) : (
          <p className="text-white/60">Rode /config no seu servidor do Discord para criar a configuração.</p>
        )}
      </section>
    </>
  );
}
