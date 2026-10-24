/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { api } from "@/lib/discord";
import { requireAdmin } from "@/lib/admin";
import { panelPayload, syncPanel } from "@/lib/panels";
import { btn, card, ghost, inp } from "@/lib/ui";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function createPanel(fd: FormData) {
  "use server";
  await requireAdmin();
  const name = str(fd, "name") || "Vendas", ch = str(fd, "channel"), ids = fd.getAll("p").map(String);
  let ok = false;
  try {
    const { data: cfg } = await db.from("discord_settings").select("guild_id").limit(1).maybeSingle();
    if (cfg && ids.length) {
      const chans: any[] = await api("GET", `/guilds/${cfg.guild_id}/channels`);
      if (chans.some((c) => c.id === ch && c.type === 0)) {
        const { data: panel } = await db.from("sales_panels").insert({ guild_id: cfg.guild_id, channel_id: ch, name }).select().single();
        if (panel) {
          await db.from("panel_products").insert(ids.map((product_id) => ({ panel_id: panel.id, product_id })));
          const m = await api("POST", `/channels/${ch}/messages`, await panelPayload(panel.id, name));
          await db.from("sales_panels").update({ message_id: m.id }).eq("id", panel.id);
          ok = true;
        }
      }
    }
  } catch (e) { console.error("panel create", e); }
  redirect(ok ? "/admin/panels?ok=1" : "/admin/panels?erro=1");
}

async function savePanel(fd: FormData) {
  "use server";
  await requireAdmin();
  const id = str(fd, "id"), name = str(fd, "name") || "Vendas", ids = fd.getAll("p").map(String);
  let ok = false;
  try {
    await db.from("sales_panels").update({ name, active: fd.get("active") === "on" }).eq("id", id);
    await db.from("panel_products").delete().eq("panel_id", id);
    if (ids.length) await db.from("panel_products").insert(ids.map((product_id) => ({ panel_id: id, product_id })));
    const { data: p } = await db.from("sales_panels").select().eq("id", id).single();
    ok = !!p && (await syncPanel(p));
  } catch (e) { console.error("panel save", e); }
  redirect(ok ? "/admin/panels?ok=1" : "/admin/panels?erro=2");
}

async function deletePanel(fd: FormData) {
  "use server";
  await requireAdmin();
  const id = str(fd, "id");
  const { data: p } = await db.from("sales_panels").select().eq("id", id).maybeSingle();
  if (p?.message_id) await api("DELETE", `/channels/${p.channel_id}/messages/${p.message_id}`).catch(() => {});
  await db.from("sales_panels").delete().eq("id", id);
  redirect("/admin/panels?ok=1");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const [{ data: cfg }, { data: products }, { data: panels }] = await Promise.all([
    db.from("discord_settings").select("guild_id").limit(1).maybeSingle(),
    db.from("products").select("id,name").eq("active", true).order("created_at"),
    db.from("sales_panels").select("*, panel_products(product_id)").order("created_at", { ascending: false }),
  ]);
  const chans: any[] = cfg ? ((await api("GET", `/guilds/${cfg.guild_id}/channels`).catch(() => [])) as any[]).filter((c) => c.type === 0) : [];
  const chName = (id: string) => chans.find((c) => c.id === id)?.name ?? id;
  const Checks = ({ sel }: { sel: string[] }) => (
    <div className="grid gap-1 sm:grid-cols-2">
      {products?.map((p) => (
        <label key={p.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" name="p" value={p.id} defaultChecked={sel.includes(p.id)} className="size-5" />{p.name}</label>
      ))}
    </div>
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">Painéis de venda</h1>
      {q.ok && <p className={`${card} text-[#00FF7F]`}>Feito.</p>}
      {q.erro === "1" && <p className={`${card} text-[#FF4B4B]`}>Não foi possível publicar. Escolha um canal, ao menos um produto, e confira as permissões do bot no canal.</p>}
      {q.erro === "2" && <p className={`${card} text-[#FF4B4B]`}>Salvo no banco, mas a mensagem no Discord não foi atualizada. Ela pode ter sido apagada ou o bot perdeu acesso ao canal.</p>}
      {!cfg ? (
        <p className="text-white/60">Rode /config no seu servidor do Discord primeiro.</p>
      ) : !products?.length ? (
        <p className="text-white/60">Cadastre produtos antes de criar um painel.</p>
      ) : (
        <details className={card}>
          <summary className="cursor-pointer font-medium">Novo painel</summary>
          <form action={createPanel} className="mt-3 space-y-3">
            <input name="name" placeholder="Título (ex.: Vendas)" className={inp} maxLength={60} />
            <select name="channel" required className={inp} defaultValue="">
              <option value="" disabled>Canal de texto…</option>
              {chans.map((c) => (<option key={c.id} value={c.id}>#{c.name}</option>))}
            </select>
            <Checks sel={[]} />
            <button className={btn}>Publicar no Discord</button>
          </form>
        </details>
      )}
      {panels?.map((p: any) => (
        <section key={p.id} className={`${card} space-y-3`}>
          <div className="text-sm text-white/60">#{chName(p.channel_id)} · {p.active ? "Ativo" : "Desativado"}{p.message_id ? "" : " · sem mensagem registrada"}</div>
          <form action={savePanel} className="space-y-3">
            <input type="hidden" name="id" value={p.id} />
            <input name="name" defaultValue={p.name} className={inp} maxLength={60} aria-label="Título do painel" />
            <Checks sel={p.panel_products.map((x: any) => x.product_id)} />
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="active" defaultChecked={p.active} className="size-5" />Painel ativo</label>
            <button className={btn}>Salvar e atualizar no Discord</button>
          </form>
          <details>
            <summary className={`${ghost} flex cursor-pointer list-none items-center`}>Excluir painel</summary>
            <form action={deletePanel} className="mt-2"><input type="hidden" name="id" value={p.id} /><button className={`${btn} !bg-[#FF4B4B]`}>Confirmar: excluir e apagar a mensagem</button></form>
          </details>
        </section>
      ))}
      {!panels?.length && <p className="text-white/60">Nenhum painel ainda.</p>}
    </>
  );
}
