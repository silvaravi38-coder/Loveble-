import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { api } from "@/lib/discord";
import { onOrderChange } from "@/lib/lifecycle";

// Apaga canais de tickets encerrados e expira pedidos pendentes vencidos.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new NextResponse("cron not configured", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const now = new Date().toISOString();
  const { data: exp } = await db.from("orders").update({ status: "expired" }).eq("status", "pending").lte("expires_at", now).select();
  for (const o of exp ?? []) await onOrderChange(o, "Sistema", true);
  const { data } = await db.from("tickets").select("id, channel_id")
    .eq("status", "closed").eq("channel_deleted", false).lte("delete_at", now).limit(50);
  for (const t of data ?? []) {
    try {
      if (t.channel_id) await api("DELETE", `/channels/${t.channel_id}`);
    } catch (e) {
      if (!String(e).includes("discord 404")) continue; // tenta de novo na próxima rodada
    }
    await db.from("tickets").update({ channel_deleted: true }).eq("id", t.id);
  }
  return NextResponse.json({ ok: true, processed: data?.length ?? 0 });
}
