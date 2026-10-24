import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/** GET /api/voices — lista as vozes da conta ElevenLabs (server-side). */
export async function GET(request: Request) {
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
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ElevenLabs HTTP ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      voices?: Array<{ voice_id?: string; name?: string }>;
    };
    const voices = (data.voices ?? [])
      .map((voice) => ({
        voice_id: voice.voice_id ?? "",
        name: voice.name ?? voice.voice_id ?? "",
      }))
      .filter((voice) => voice.voice_id !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ voices });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
