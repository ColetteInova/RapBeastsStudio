import { NextResponse } from "next/server";
import {
  adminConfigured,
  getStripe,
  stripeConfigured,
  verifyFirebaseToken,
} from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/**
 * POST /api/billing/checkout — cria a sessão de assinatura do Stripe.
 * O cliente envia o idToken do Firebase; o servidor verifica e devolve a URL.
 */
export async function POST(request: Request) {
  if (!stripeConfigured() || getEnv("STRIPE_PRICE_ID") === "") {
    return NextResponse.json(
      { error: "Stripe não configurado (STRIPE_SECRET_KEY/STRIPE_PRICE_ID)" },
      { status: 503 },
    );
  }
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "Firebase Admin não configurado no servidor" },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    idToken?: string;
  } | null;
  const uid = await verifyFirebaseToken(String(body?.idToken ?? ""));
  if (!uid) {
    return NextResponse.json(
      { error: "sessão inválida — entre com Google" },
      { status: 401 },
    );
  }
  const origin = request.headers.get("origin") ?? "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: getEnv("STRIPE_PRICE_ID"), quantity: 1 }],
      client_reference_id: uid,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      subscription_data: { metadata: { uid } },
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
