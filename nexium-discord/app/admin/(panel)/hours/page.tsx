import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { btn, card, inp } from "@/lib/ui";

const DAYS: [string, string][] = [["1", "Segunda"], ["2", "Terça"], ["3", "Quarta"], ["4", "Quinta"], ["5", "Sexta"], ["6", "Sábado"], ["0", "Domingo"]];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const clamp = (v: string, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

async function save(fd: FormData) {
  "use server";
  await requireAdmin();
  const hours: Record<string, string[][]> = {};
  let invalid = false;
  for (const [d] of DAYS) {
    const r: string[][] = [];
    for (const n of [1, 2]) {
      const a = str(fd, `d${d}_${n}_a`), b = str(fd, `d${d}_${n}_b`);
      if (!a && !b) continue;
      if (!/^\d\d:\d\d$/.test(a) || !/^\d\d:\d\d$/.test(b) || a >= b) invalid = true;
      else r.push([a, b]);
    }
    hours[d] = r;
  }
  if (invalid) redirect("/admin/hours?erro=1");
  await db.from("discord_settings").update({
    hours,
    block_duplicates: fd.get("dup") === "on",
    save_transcripts: fd.get("tr") === "on",
    auto_delete_minutes: clamp(str(fd, "del"), 1, 1440, 5),
    order_expire_minutes: clamp(str(fd, "exp"), 5, 1440, 30),
  }).eq("guild_id", str(fd, "guild_id"));
  redirect("/admin/hours?ok=1");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const { data: cfg } = await db.from("discord_settings").select().limit(1).maybeSingle();
  if (!cfg) return (<><h1 className="text-2xl font-semibold">Atendimento</h1><p className="text-white/60">Rode /config no seu servidor do Discord para criar a configuração.</p></>);
  const h: Record<string, string[][]> = cfg.hours ?? {};
  return (
    <>
      <h1 className="text-2xl font-semibold">Atendimento</h1>
      {q.ok && <p className={`${card} text-[#00FF7F]`}>Salvo.</p>}
      {q.erro && <p className={`${card} text-[#FF4B4B]`}>Confira os horários: o fim precisa ser depois do início. Deixe os dois vazios para fechar o período.</p>}
      <form action={save} className="space-y-4">
        <input type="hidden" name="guild_id" value={cfg.guild_id} />
        <section className={`${card} space-y-3`}>
          <h2 className="font-semibold">Horários (fuso de São Paulo)</h2>
          {DAYS.map(([d, name]) => (
            <div key={d} className="space-y-1">
              <div className="text-sm text-white/60">{name}</div>
              {[1, 2].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <input type="time" name={`d${d}_${n}_a`} defaultValue={h[d]?.[n - 1]?.[0] ?? ""} className={inp} aria-label={`${name}, período ${n}, início`} />
                  <span className="text-white/50">até</span>
                  <input type="time" name={`d${d}_${n}_b`} defaultValue={h[d]?.[n - 1]?.[1] ?? ""} className={inp} aria-label={`${name}, período ${n}, fim`} />
                </div>
              ))}
            </div>
          ))}
        </section>
        <section className={`${card} space-y-3`}>
          <h2 className="font-semibold">Regras</h2>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="dup" defaultChecked={cfg.block_duplicates} className="size-5" />Bloquear ticket duplicado no mesmo setor</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="tr" defaultChecked={cfg.save_transcripts} className="size-5" />Enviar a transcrição do ticket ao canal de logs ao encerrar</label>
          <label className="block text-sm text-white/60">Apagar canal do ticket depois de (minutos)
            <input name="del" type="number" min={1} max={1440} defaultValue={cfg.auto_delete_minutes} className={`${inp} mt-1`} />
          </label>
          <label className="block text-sm text-white/60">Expirar pedido pendente depois de (minutos)
            <input name="exp" type="number" min={5} max={1440} defaultValue={cfg.order_expire_minutes} className={`${inp} mt-1`} />
          </label>
        </section>
        <button className={btn}>Salvar</button>
      </form>
    </>
  );
}
