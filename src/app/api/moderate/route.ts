import { NextResponse } from "next/server";
import { moderateText } from "@/lib/ai";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage } from "@/lib/env";

/**
 * POST /api/moderate — classifica letra por LLM (Fase 3: usado antes de
 * publicar na vitrine comunitária).
 */
export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    await consumeCredit(auth.uid);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as {
    text?: string;
  } | null;
  const text = String(body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "texto obrigatório" }, { status: 400 });
  }
  try {
    const result = await moderateText(text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
