import { NextResponse } from "next/server";

// Pendente: a validação da assinatura e o formato do evento dependem da documentação da TurboFyPay.
// Ao implementar: validar assinatura, conferir pedido, valor e id da cobrança, e marcar como pago
// uma única vez (update com .eq("status","pending")).
export async function POST() {
  return NextResponse.json({ error: "Webhook ainda não configurado." }, { status: 501 });
}
