import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supa() {
  const c = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => c.getAll(),
      setAll: (list: { name: string; value: string; options?: Parameters<typeof c.set>[2] }[]) => {
        try { list.forEach(({ name, value, options }) => c.set(name, value, options)); } catch { /* chamado de Server Component */ }
      },
    },
  });
}
