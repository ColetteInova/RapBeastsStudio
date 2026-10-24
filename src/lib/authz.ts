/**
 * Autorização das rotas de IA (Fase 2):
 *   1. ADMIN_TOKEN (dev, bypass) — mesmo token de antes;
 *   2. Firebase idToken válido + entitlement premium ativo.
 * Sem Firebase Admin configurado e sem ADMIN_TOKEN → 503 claro.
 */
import { adminConfigured, hasEntitlement, verifyFirebaseToken } from "@/lib/billing";
import { adminTokenConfigured, isAuthorized } from "@/lib/env";

export interface AuthResult {
  ok: boolean;
  uid: string;
  /** 401 não autenticado · 402 sem premium · 503 servidor não configurado */
  status: number;
  reason: string;
}

export async function authorizeRequest(request: Request): Promise<AuthResult> {
  // 1) Dev: ADMIN_TOKEN
  if (adminTokenConfigured() && isAuthorized(request)) {
    return { ok: true, uid: "admin", status: 200, reason: "" };
  }
  if (!adminConfigured()) {
    return {
      ok: false,
      uid: "",
      status: 503,
      reason:
        "servidor sem Firebase Admin (FIREBASE_SERVICE_ACCOUNT_JSON) — configure ou use o ADMIN_TOKEN",
    };
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return {
      ok: false,
      uid: "",
      status: 401,
      reason: "entre com Google no Studio para usar o premium",
    };
  }
  const uid = await verifyFirebaseToken(header.slice(7));
  if (!uid) {
    return { ok: false, uid: "", status: 401, reason: "sessão inválida — entre de novo" };
  }
  if (!(await hasEntitlement(uid))) {
    return {
      ok: false,
      uid,
      status: 402,
      reason: "premium inativo — assine para continuar",
    };
  }
  return { ok: true, uid, status: 200, reason: "" };
}
