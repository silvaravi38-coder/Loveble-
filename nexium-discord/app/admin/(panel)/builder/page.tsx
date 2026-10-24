import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { execute, listGuilds, makePlan, type Item, type Mode } from "@/lib/builder/plan";
import { PRESETS, type PresetId } from "@/lib/builder/templates";
import { btn, card, inp } from "@/lib/ui";

export const maxDuration = 60;

const MODES: Record<Mode, [string, string]> = {
  auto: ["Configuração automática", "Só adiciona o essencial que falta. Não altera nem remove nada."],
  full: ["Criar servidor completo", "Monta a estrutura inteira do modelo num servidor novo. Só cria o que falta."],
  rebuild: ["Refazer a estrutura", "Ajusta o que existe ao modelo e permite remover o que sobra, com confirmação."],
};
const LABEL = { create: "Criar", update: "Ajustar", remove: "Remover", keep: "Já existe" } as const;
const KIND = { role: "cargo", category: "categoria", channel: "canal" } as const;

async function products() {
  const { data } = await db.from("products").select("name,category").eq("active", true).order("created_at");
  return data ?? [];
}

async function apply(fd: FormData) {
  "use server";
  const user = await requireAdmin();
  const guild = String(fd.get("guild")), mode = String(fd.get("mode")) as Mode, preset = String(fd.get("preset")) as PresetId;
  if (!(mode in MODES) || !(preset in PRESETS)) return;
  const back = `/admin/builder?guild=${guild}&mode=${mode}&preset=${preset}`;
  const remove = mode === "rebuild" && fd.get("remove") === "on";
  if (remove && String(fd.get("typed") ?? "").trim() !== "REFAZER") redirect(`${back}&erro=confirmacao`);
  let msg: string;
  try {
    if (!(await listGuilds()).some((x) => x.id === guild)) return;
    const plan = await makePlan(guild, mode, preset, await products());
    const r = await execute(guild, plan, { remove, panels: fd.get("panels") === "on" }, user.email ?? user.id);
    msg = r.finished
      ? `Concluído: ${r.done} ações aplicadas.${r.notes.length ? " " + r.notes.join(" ") : ""}`
      : `Aplicadas ${r.done} de ${r.total}. Abra a prévia e aplique de novo para continuar.`;
  } catch (e) {
    console.error("builder", e);
    msg = String(e).includes(" 403 ") ? "O bot não tem permissão. Dê Gerenciar canais e Gerenciar cargos ao bot e suba o cargo dele." : "Não foi possível aplicar. Veja os logs do servidor.";
  }
  redirect(`${back}&resultado=${encodeURIComponent(msg)}`);
}

function Group({ op, items }: { op: Item["op"]; items: Item[] }) {
  const list = items.filter((i) => i.op === op);
  if (!list.length) return null;
  return (
    <details open={op !== "keep"} className={card}>
      <summary className="cursor-pointer font-medium">{LABEL[op]} ({list.length})</summary>
      <ul className="mt-2 space-y-1 text-sm text-white/80">
        {list.map((i, k) => (<li key={k}>{KIND[i.kind]} · {i.name}{i.note ? <span className="text-white/50"> · {i.note}</span> : null}</li>))}
      </ul>
    </details>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await searchParams;
  const guilds = await listGuilds().catch(() => []);
  const mode = (q.mode && q.mode in MODES ? q.mode : "auto") as Mode;
  const preset = (q.preset && q.preset in PRESETS ? q.preset : "completa") as PresetId;
  const guild = guilds.find((x) => x.id === q.guild)?.id;
  let plan = null, planError = "";
  if (guild && q.preview) {
    try { plan = await makePlan(guild, mode, preset, await products()); }
    catch (e) { console.error("plan", e); planError = "Não foi possível ler o servidor. Confira se o bot está nele e tem permissão de ver canais e cargos."; }
  }
  const changes = plan?.items.filter((i) => i.op !== "keep").length ?? 0;
  const removals = plan?.items.filter((i) => i.op === "remove").length ?? 0;
  return (
    <>
      <h1 className="text-2xl font-semibold">Builder de servidores</h1>
      {q.resultado && <p className={`${card} text-[#00FF7F]`}>{q.resultado}</p>}
      {q.erro === "confirmacao" && <p className={`${card} text-[#FF4B4B]`}>Digite REFAZER para confirmar a remoção.</p>}
      {!guilds.length ? (
        <p className="text-white/60">O bot ainda não está em nenhum servidor, ou o token não está configurado.</p>
      ) : (
        <form className={`${card} space-y-3`}>
          <input type="hidden" name="preview" value="1" />
          <label className="block text-sm text-white/60">Servidor
            <select name="guild" defaultValue={guild} required className={`${inp} mt-1`}>
              <option value="">Escolha…</option>
              {guilds.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm text-white/60">Modo</legend>
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <label key={m} className="flex min-h-11 items-start gap-3 rounded-lg border border-white/10 p-3">
                <input type="radio" name="mode" value={m} defaultChecked={m === mode} className="mt-1 size-5" />
                <span><b>{MODES[m][0]}</b><br /><span className="text-sm text-white/60">{MODES[m][1]}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="block text-sm text-white/60">Modelo (a configuração automática usa sempre o enxuto)
            <select name="preset" defaultValue={preset} className={`${inp} mt-1`}>
              {(Object.keys(PRESETS) as PresetId[]).map((p) => (<option key={p} value={p}>{PRESETS[p].label}</option>))}
            </select>
          </label>
          <button className={btn}>Ver prévia</button>
        </form>
      )}
      {planError && <p className={`${card} text-[#FF4B4B]`}>{planError}</p>}
      {plan && (
        <>
          <h2 className="text-lg font-semibold">Prévia</h2>
          <Group op="create" items={plan.items} />
          <Group op="update" items={plan.items} />
          <Group op="remove" items={plan.items} />
          <Group op="keep" items={plan.items} />
          {!changes ? (
            <p className="text-white/60">Nada a fazer: o servidor já está de acordo com o modelo.</p>
          ) : (
            <form action={apply} className={`${card} space-y-3`}>
              <input type="hidden" name="guild" value={guild} /><input type="hidden" name="mode" value={mode} /><input type="hidden" name="preset" value={preset} />
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="panels" defaultChecked className="size-5" />Publicar os painéis de tickets e de vendas</label>
              {removals > 0 && (
                <>
                  <label className="flex min-h-11 items-center gap-3 text-[#FF4B4B]"><input type="checkbox" name="remove" className="size-5" />Remover os {removals} itens da lista &quot;Remover&quot;. Não dá para desfazer.</label>
                  <input name="typed" placeholder="Para remover, digite REFAZER" className={inp} autoComplete="off" />
                </>
              )}
              <button className={btn}>Confirmar e aplicar</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
