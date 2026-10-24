/**
 * Variáveis de ambiente SERVER-SIDE (nunca prefixo NEXT_PUBLIC).
 * As chaves de IA vivem só no servidor; as rotas de API são o único
 * caminho até elas — regra de ouro do custo (docs/studio-app.md §7.3).
 */

export function getEnv(name: string): string {
  return process.env[name] ?? "";
}

/** Token de acesso do autor (provisório até o Stripe da Fase 2 avançada). */
export function adminTokenConfigured(): boolean {
  return getEnv("ADMIN_TOKEN") !== "";
}

export function isAuthorized(request: Request): boolean {
  const token = getEnv("ADMIN_TOKEN");
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
