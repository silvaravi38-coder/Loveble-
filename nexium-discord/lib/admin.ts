import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { supa } from "@/lib/supabase-server";

// Chame em toda página e em toda server action do painel: actions são endpoints públicos.
export async function requireAdmin() {
  const s = await supa();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data } = await db.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) redirect("/admin/login?erro=acesso");
  return user;
}
