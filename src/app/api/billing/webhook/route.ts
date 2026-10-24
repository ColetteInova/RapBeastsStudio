import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, setEntitlement, stripeConfigured } from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/**
 * POST /api/billing/webhook — eventos do Stripe (assinatura de verdade é o
 * Stripe; o webhook é a única fonte de verdade do premium). Verifica a
 * assinatura e atualiza a coleção `entitlements` via Firebase Admin.
 */
export async function POST(request: Request) {
  const secret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!stripeConfigured() || !secret) {
    return NextResponse.json(
      { error: "Stripe webhook não configurado (STRIPE_WEBHOOK_SECRET)" },
      { status: 503 },
    );
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "sem stripe-signature" }, { status: 400 });
  }
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    return NextResponse.json(
      { error: `assinatura inválida: ${errorMessage(error)}` },
      { status: 400 },
    );
  }
  try {
    await handleBillingEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}

async function handleBillingEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.client_reference_id;
      if (!uid) return;
      if (typeof session.subscription === "string") {
        const subscription = await getStripe().subscriptions.retrieve(
          session.subscription,
        );
        await applySubscription(uid, subscription);
      } else {
        await setEntitlement(uid, {
          premium: true,
          status: "one_time",
          customer_id: String(session.customer ?? ""),
          subscription_id: "",
          valid_until: null,
        });
      }
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.uid;
      if (!uid) return;
      await applySubscription(uid, subscription);
      return;
    }
    default:
      return;
  }
}

async function applySubscription(
  uid: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const active =
    subscription.status === "active" || subscription.status === "trialing";
  // Na API 2025+ o fim do período vive no item da assinatura.
  const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? null;
  await setEntitlement(uid, {
    premium: active,
    status: subscription.status,
    customer_id: String(subscription.customer),
    subscription_id: subscription.id,
    valid_until: periodEnd !== null ? Math.floor(periodEnd) : null,
  });
}
