import { NextResponse } from "next/server";
import { generateLyrics } from "@/lib/ai";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage } from "@/lib/env";

/** POST /api/lyrics — gera letras de rima (LLM server-side). */
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
    theme?: string;
    language?: string;
    turns?: number;
  } | null;
  const theme = String(body?.theme ?? "").trim();
  if (!theme) {
    return NextResponse.json({ error: "tema obrigatório" }, { status: 400 });
  }
  const turns = Math.min(Math.max(Number(body?.turns ?? 2) || 2, 1), 4);
  try {
    const result = await generateLyrics({
      theme,
      language: body?.language === "en" ? "en" : "pt",
      turns,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
