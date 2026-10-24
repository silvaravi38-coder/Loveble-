import { redirect } from "next/navigation";
import { supa } from "@/lib/supabase-server";
import { btn, inp } from "@/lib/ui";

async function login(fd: FormData) {
  "use server";
  const s = await supa();
  const { error } = await s.auth.signInWithPassword({ email: String(fd.get("email")), password: String(fd.get("password")) });
  if (error) redirect("/admin/login?erro=1");
  redirect("/admin");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[#2B2D31] p-4 text-white">
      <form action={login} className="w-full max-w-sm space-y-3 rounded-xl border border-white/10 bg-[#313338] p-5">
        <h1 className="text-xl font-semibold">Entrar no painel</h1>
        <input name="email" type="email" required autoComplete="email" placeholder="E-mail" className={inp} />
        <input name="password" type="password" required autoComplete="current-password" placeholder="Senha" className={inp} />
        {erro && <p className="text-sm text-[#FF4B4B]">{erro === "acesso" ? "Esta conta não tem acesso ao painel." : "E-mail ou senha incorretos."}</p>}
        <button className={`${btn} w-full`}>Entrar</button>
      </form>
    </main>
  );
}
