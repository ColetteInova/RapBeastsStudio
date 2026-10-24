import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

function isLoopback(request: NextRequest): boolean {
  const hostname = request.nextUrl.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(hostname)) return true;

  // hostname real não é loopback (ex.: acesso via IP da rede) — verifica o IP
  // do cliente reportado pelo edge/proxy.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return false;
  const clientIp = (forwardedFor.split(",")[0] ?? "").trim().toLowerCase();
  return LOOPBACK_IPS.has(clientIp);
}

// Área de admin restrita: só abre em localhost (ex.: http://localhost:3000/admin).
export function proxy(request: NextRequest) {
  if (!isLoopback(request)) {
    return NextResponse.json(
      { error: "Acesso ao admin permitido apenas em localhost." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
