import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#2B2D31] p-6 text-white">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Nexium</h1>
        <p className="mt-2 text-white/60">Bot do Discord e painel administrativo.</p>
        <Link href="/admin" className="mt-4 inline-block min-h-11 rounded-lg bg-[#5865F2] px-5 py-3 font-medium">Entrar no painel</Link>
      </div>
    </main>
  );
}
