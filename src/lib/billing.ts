/**
 * Billing e entitlements (Fase 2): Firebase Admin (conta de serviço) +
 * Stripe. Tudo SERVER-SIDE — o cliente só recebe idToken/URLs.
 *
 * Regra de ouro do custo (docs/studio-app.md §7.3): nenhuma chamada de IA
 * passa sem entitlement válido; créditos diários limitam o estrago.
 */
import { cert, getApps as getAdminApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";
import { getEnv } from "@/lib/env";

let adminApp: App | null = null;

export function adminConfigured(): boolean {
  return getEnv("FIREBASE_SERVICE_ACCOUNT_JSON") !== "";
}

function getAdmin(): App {
  if (!adminApp) {
    const raw = getEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!raw) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não configurado no servidor");
    }
    const serviceAccount = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    adminApp =
      getAdminApps().length === 0
        ? initializeApp({
            credential: cert({
              projectId: serviceAccount.project_id ?? "",
              clientEmail: serviceAccount.client_email ?? "",
              privateKey: serviceAccount.private_key ?? "",
            }),
          })
        : getAdminApps()[0];
  }
  return adminApp;
}

/** Verifica o idToken do Firebase Auth (cliente Studio) e devolve o uid. */
export async function verifyFirebaseToken(idToken: string): Promise<string | null> {
  try {
    const decoded = await getAuth(getAdmin()).verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

export interface Entitlement {
  premium: boolean;
  status: string;
  customer_id: string;
  subscription_id: string;
  /** epoch em segundos do fim do período pago (null = sem validade) */
  valid_until: number | null;
}

export async function getEntitlement(uid: string): Promise<Entitlement | null> {
  const snapshot = await getFirestore(getAdmin())
    .collection("entitlements")
    .doc(uid)
    .get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  return {
    premium: Boolean(data.premium),
    status: String(data.status ?? ""),
    customer_id: String(data.customer_id ?? ""),
    subscription_id: String(data.subscription_id ?? ""),
    valid_until: data.valid_until ? Number(data.valid_until) : null,
  };
}

export async function hasEntitlement(uid: string): Promise<boolean> {
  const entitlement = await getEntitlement(uid);
  if (!entitlement || !entitlement.premium) return false;
  if (
    entitlement.valid_until !== null &&
    entitlement.valid_until * 1000 < Date.now()
  ) {
    return false;
  }
  return true;
}

export function stripeConfigured(): boolean {
  return getEnv("STRIPE_SECRET_KEY") !== "";
}

export function getStripe(): Stripe {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"));
}

const DEFAULT_DAILY_LIMIT = 500;

export function dailyLimit(): number {
  const parsed = Number(getEnv("PREMIUM_DAILY_LIMIT"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

/** Consome 1 crédito do dia; lança quando o limite estoura. */
export async function consumeCredit(uid: string): Promise<void> {
  const db = getFirestore(getAdmin());
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("usage").doc(`${day}_${uid}`);
  const snapshot = await ref.get();
  const used = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0;
  if (used >= dailyLimit()) {
    throw new Error(`limite diário de créditos atingido (${dailyLimit()})`);
  }
  await ref.set({ count: used + 1, day, uid }, { merge: true });
}

export async function setEntitlement(
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  await getFirestore(getAdmin())
    .collection("entitlements")
    .doc(uid)
    .set({ ...data, updated_at: new Date() }, { merge: true });
}
