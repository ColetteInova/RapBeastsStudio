import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertLocalhost } from "@/lib/local_only";
import {
  generateRhymes,
  rhymeCandidatesOf,
  type RhymeModelData,
} from "@/lib/rhyme_model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS_DIR = path.join(process.cwd(), "data", "rhyme-models");
const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let body: {
    modelId?: unknown;
    seed?: unknown;
    rhyme?: unknown;
    count?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  if (!ID_RE.test(modelId)) {
    return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  }

  let model: RhymeModelData;
  try {
    model = JSON.parse(
      await readFile(path.join(MODELS_DIR, `${modelId}.json`), "utf8"),
    ) as RhymeModelData;
  } catch {
    return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
  }

  const seed = typeof body?.seed === "string" ? body.seed.trim().slice(0, 120) : "";
  const rhyme =
    typeof body?.rhyme === "string" ? body.rhyme.trim().slice(0, 60) : "";
  const count =
    typeof body?.count === "number" && Number.isFinite(body.count)
      ? Math.round(body.count)
      : 4;

  if (rhyme && !rhymeCandidatesOf(model, rhyme)) {
    return NextResponse.json(
      { error: `Não achei rimas para "${rhyme}" nesse modelo.` },
      { status: 400 },
    );
  }

  const lines = generateRhymes(model, {
    seed: seed || undefined,
    rhyme: rhyme || null,
    count,
  });

  return NextResponse.json({ lines });
}
