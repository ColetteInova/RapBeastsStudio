const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

export function isLoopbackRequest(req: Request): boolean {
  const hostname = new URL(req.url).hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(hostname)) return true;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) return false;
  return forwardedFor
    .split(",")
    .some((ip) => LOOPBACK_IPS.has(ip.trim().toLowerCase()));
}

// Defense-in-depth para as rotas de admin: o proxy.ts já bloqueia /admin/:path*
// fora de localhost, mas as rotas se protegem de novo caso o matcher mude.
export function assertLocalhost(req: Request): Response | null {
  if (isLoopbackRequest(req)) return null;
  return new Response(
    JSON.stringify({ error: "Acesso ao admin permitido apenas em localhost." }),
    {
      status: 403,
      headers: { "content-type": "application/json" },
    },
  );
}
