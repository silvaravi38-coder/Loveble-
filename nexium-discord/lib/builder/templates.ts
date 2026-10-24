export type Access = "public" | "readonly" | "staff";
export type ChanT = { name: string; kind: "text" | "voice"; access: Access; topic?: string; slot?: "announce" | "sales" | "tickets" | "orders" | "logs" };
export type CatT = { name: string; access?: Access; slot?: "ticketsCat"; chans: ChanT[] };
export type RoleT = { key: "admin" | "staff" | "customer"; name: string; color: number };
export type Layout = { roles: RoleT[]; cats: CatT[] };

export const PRESETS = {
  enxuta: { label: "Loja enxuta", catalog: false, community: false },
  completa: { label: "Loja completa", catalog: true, community: false },
  comunidade: { label: "Loja e comunidade", catalog: true, community: true },
} as const;
export type PresetId = keyof typeof PRESETS;

const EMOJI: Record<string, string> = { Streaming: "📼", "Música": "🎧", Discord: "💎", "Educação": "📚" };
const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// O catálogo vem dos produtos cadastrados: nada de produto fixo no código.
export function buildLayout(preset: PresetId, products: { name: string; category: string | null }[]): Layout {
  const p = PRESETS[preset];
  const t = (name: string, access: Access, extra: Partial<ChanT> = {}): ChanT => ({ name, kind: "text", access, ...extra });
  const v = (name: string, access: Access): ChanT => ({ name, kind: "voice", access });

  const cats: CatT[] = [
    { name: "📢・INFORMAÇÕES", chans: [t("📣・anuncios", "readonly", { slot: "announce", topic: "Novidades da loja." }), t("📜・regras", "readonly"), t("❓・duvidas", "readonly")] },
    { name: "🛒・LOJA", chans: [
      t("🛒・comprar", "readonly", { slot: "sales", topic: "Escolha um produto no menu para comprar." }),
      t("🎫・suporte", "readonly", { slot: "tickets", topic: "Abra um ticket para falar com a equipe." }),
    ] },
  ];

  if (p.catalog && products.length) {
    const by = new Map<string, string[]>();
    for (const pr of products) {
      const k = pr.category || "Outros";
      by.set(k, [...(by.get(k) ?? []), pr.name]);
    }
    for (const [k, names] of by) {
      const e = EMOJI[k] ?? "🛒";
      const seen = new Set<string>();
      const chans: ChanT[] = [];
      for (const n of names) {
        const s = slug(n);
        if (!s || seen.has(s)) continue;
        seen.add(s);
        chans.push(t(`${e}・${s}`, "readonly", { topic: n }));
      }
      cats.push({ name: `${e}・${k.toUpperCase()}`, chans: chans.slice(0, 45) });
    }
  }
  if (p.community) cats.push({ name: "💬・COMUNIDADE", chans: [t("💬・bate-papo", "public"), v("🔊 Bate-papo", "public")] });

  cats.push({ name: "🎫・ATENDIMENTOS", access: "staff", slot: "ticketsCat", chans: [] });
  cats.push({ name: "🔒・EQUIPE", access: "staff", chans: [
    t("🧾・pedidos", "staff", { slot: "orders" }),
    t("📋・logs", "staff", { slot: "logs" }),
    t("💬・equipe", "staff"),
    v("🔊 Equipe", "staff"),
  ] });

  return {
    roles: [
      { key: "admin", name: "Administração", color: 0xff4b4b },
      { key: "staff", name: "Atendimento", color: 0x5865f2 },
      { key: "customer", name: "Cliente", color: 0x00ff7f },
    ],
    cats,
  };
}
