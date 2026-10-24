export type Charge = { chargeId: string; payload: string };

export const pixConfigured = () =>
  !!(process.env.TURBOFYPAY_CLIENT_ID && process.env.TURBOFYPAY_CLIENT_SECRET && process.env.TURBOFYPAY_API_URL);

// Isolado de propósito: os endpoints e o formato de resposta da TurboFyPay dependem da documentação
// oficial, que ainda não foi fornecida. Sem ela, o bot usa a chave Pix manual e a confirmação pela equipe.
export async function createPixCharge(_order: { orderId: string; amountCents: number }): Promise<Charge | null> {
  if (!pixConfigured()) return null;
  throw new Error("Integração TurboFyPay pendente: falta a documentação da API.");
}
