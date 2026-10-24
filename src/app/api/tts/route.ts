import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/**
 * POST /api/tts — TTS da ElevenLabs COM timestamps de caractere.
 * Proxy server-side: a chave nunca sai do servidor.
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
  const key = getEnv("ELEVENLABS_API_KEY");
  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY não configurada no servidor" },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    text?: string;
    voice_id?: string;
    model_id?: string;
  } | null;
  const text = String(body?.text ?? "").trim();
  const voiceId = String(body?.voice_id ?? "").trim();
  if (!text || !voiceId) {
    return NextResponse.json(
      { error: "text e voice_id são obrigatórios" },
      { status: 400 },
    );
  }
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: String(body?.model_id ?? "eleven_multilingual_v2"),
        }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ElevenLabs HTTP ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      audio_base64?: string;
      alignment?: unknown;
    };
    return NextResponse.json({
      audio_base64: data.audio_base64 ?? "",
      alignment: data.alignment ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
