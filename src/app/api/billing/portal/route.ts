import { NextResponse } from "next/server";
import {
  adminConfigured,
  getEntitlement,
  getStripe,
  stripeConfigured,
  verifyFirebaseToken,
} from "@/lib/billing";
import { errorMessage } from "@/lib/env";

/** POST /api/billing/portal — portal do cliente (gerenciar assinatura). */
export async function POST(request: Request) {
  if (!stripeConfigured() || !adminConfigured()) {
    return NextResponse.json(
      { error: "servidor não configurado (Stripe/Firebase Admin)" },
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
  const entitlement = await getEntitlement(uid);
  if (!entitlement?.customer_id) {
    return NextResponse.json(
      { error: "sem assinatura para gerenciar" },
      { status: 400 },
    );
  }
  const origin = request.headers.get("origin") ?? "http://localhost:3000";
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: entitlement.customer_id,
      return_url: `${origin}/`,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
