import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/**
 * POST /api/beat — gera instrumental por IA (estilo Suno, padrão de fato
 * gcui-art/suno-api — ver docs/suno.md). Gera → faz polling → baixa o áudio
 * no servidor → devolve base64 (evita CORS/hotlink no cliente).
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
  const base = getEnv("SUNO_API_BASE_URL");
  if (!base) {
    return NextResponse.json(
      { error: "SUNO_API_BASE_URL não configurado no servidor" },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    style?: string;
  } | null;
  const style = String(body?.style ?? "hip hop");
  const prompt =
    String(body?.prompt ?? "").trim() || `${style} instrumental beat`;
  const fullPrompt = `${prompt} (${style}, instrumental, sem vocal)`;
  try {
    const generate = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: fullPrompt, make_instrumental: true, wait_audio: false }),
    });
    if (!generate.ok) {
      throw new Error(`Suno generate HTTP ${generate.status}`);
    }
    const generated = (await generate.json()) as Array<{ id?: string }>;
    const id = generated[0]?.id;
    if (!id) {
      throw new Error("Suno não retornou um id de geração");
    }
    // Polling: até ~2min (30 tentativas × 4s)
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const check = await fetch(`${base}/api/get?ids=${encodeURIComponent(id)}`);
      if (!check.ok) continue;
      const tracks = (await check.json()) as Array<{
        status?: string;
        audio_url?: string;
      }>;
      const track = tracks[0];
      if (track?.status === "streaming" && track.audio_url) {
        const audio = await fetch(track.audio_url);
        if (!audio.ok) {
          throw new Error(`Suno audio HTTP ${audio.status}`);
        }
        const bytes = Buffer.from(await audio.arrayBuffer());
        return NextResponse.json({
          audio_base64: bytes.toString("base64"),
          mime: audio.headers.get("content-type") ?? "audio/mpeg",
          prompt: fullPrompt,
        });
      }
      if (track?.status === "error" || track?.status === "failed") {
        throw new Error(`Suno falhou a geração (status ${track.status})`);
      }
    }
    return NextResponse.json(
      { error: "timeout aguardando o beat — tente de novo", id },
      { status: 504 },
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
