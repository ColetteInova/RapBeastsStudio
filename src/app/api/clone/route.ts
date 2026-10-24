import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";
import { consumeCredit } from "@/lib/billing";
import { errorMessage, getEnv } from "@/lib/env";

/**
 * POST /api/clone — clona voz (IVC, instant voice cloning) na ElevenLabs.
 * Multipart: name + files[] (1–3 amostras de áudio).
 * O retorno `requires_verification` indica que a voz precisa de verificação
 * de consentimento (fluxo PVC completo fica para um próximo passo).
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
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const type = String(form.get("type") ?? "ivc");
  const files = form
    .getAll("files")
    .filter((file): file is File => file instanceof File);
  if (!name || files.length === 0) {
    return NextResponse.json(
      { error: "name e ao menos 1 arquivo de áudio são obrigatórios" },
      { status: 400 },
    );
  }
  if (files.length > 3) {
    return NextResponse.json(
      { error: "máximo de 3 amostras de áudio" },
      { status: 400 },
    );
  }
  try {
    if (type === "pvc") {
      // PVC (professional voice cloning): cria a voz vazia, sobe as amostras.
      // A verificação de consentimento é exigida pela ElevenLabs — concluir
      // no dashboard quando `requires_verification` for true.
      const language = String(form.get("language") ?? "pt");
      const create = await fetch("https://api.elevenlabs.io/v1/voices/pvc", {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ name, language }),
      });
      if (!create.ok) {
        const detail = (await create.text()).slice(0, 300);
        throw new Error(`ElevenLabs PVC HTTP ${create.status}: ${detail}`);
      }
      const created = (await create.json()) as { voice_id?: string };
      const voiceId = created.voice_id ?? "";
      if (!voiceId) {
        throw new Error("ElevenLabs não retornou voice_id");
      }
      const samples = new FormData();
      for (const file of files) {
        samples.append("files", file, file.name);
      }
      const upload = await fetch(
        `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}/samples`,
        { method: "POST", headers: { "xi-api-key": key }, body: samples },
      );
      if (!upload.ok) {
        const detail = (await upload.text()).slice(0, 300);
        throw new Error(`ElevenLabs samples HTTP ${upload.status}: ${detail}`);
      }
      return NextResponse.json({
        voice_id: voiceId,
        requires_verification: true,
        type: "pvc",
      });
    }
    // IVC (instant voice cloning)
    const upstream = new FormData();
    upstream.append("name", name);
    for (const file of files) {
      upstream.append("files", file, file.name);
    }
    if (form.get("remove_background_noise")) {
      upstream.append("remove_background_noise", "true");
    }
    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: upstream,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ElevenLabs HTTP ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      voice_id?: string;
      requires_verification?: boolean;
    };
    return NextResponse.json({
      voice_id: data.voice_id ?? "",
      requires_verification: data.requires_verification ?? false,
      type: "ivc",
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
