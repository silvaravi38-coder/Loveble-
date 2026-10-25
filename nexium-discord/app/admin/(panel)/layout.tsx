import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabase-server";

async function logout() {
  "use server";
  const s = await supa();
  await s.auth.signOut();
  redirect("/admin/login");
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const links = [["/admin", "Geral"], ["/admin/products", "Produtos"], ["/admin/stock", "Estoque"], ["/admin/coupons", "Cupons"], ["/admin/orders", "Pedidos"], ["/admin/reviews", "Avaliações"], ["/admin/reports", "Relatórios"], ["/admin/panels", "Painéis"], ["/admin/hours", "Horários"], ["/admin/builder", "Builder"]];
  return (
    <div className="min-h-screen bg-[#2B2D31] text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#2B2D31]/95 backdrop-blur">
        <nav className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-3 py-2 text-sm">
          <span className="mr-2 font-semibold">Nexium</span>
          {links.map(([h, t]) => (
            <Link key={h} href={h} className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/10 hover:text-white">{t}</Link>
          ))}
          <form action={logout} className="ml-auto"><button className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/10">Sair</button></form>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 p-4">{children}</main>
    </div>
  );
}
