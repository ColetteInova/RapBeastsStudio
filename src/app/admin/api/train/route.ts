import { NextResponse } from "next/server";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertLocalhost } from "@/lib/local_only";
import {
  cleanLyrics,
  trainRhymeModel,
  type RhymeModelData,
  type RhymeModelMeta,
} from "@/lib/rhyme_model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS_DIR = path.join(process.cwd(), "data", "rhyme-models");

function toMeta(model: RhymeModelData): RhymeModelMeta {
  return {
    id: model.id,
    name: model.name,
    sourceUrl: model.sourceUrl,
    createdAt: model.createdAt,
    order: model.order,
    stats: model.stats,
  };
}

export async function GET(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let files: string[] = [];
  try {
    files = await readdir(MODELS_DIR);
  } catch {
    return NextResponse.json({ models: [] });
  }

  const models: RhymeModelMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        await readFile(path.join(MODELS_DIR, file), "utf8"),
      ) as RhymeModelData;
      models.push(toMeta(data));
    } catch {
      // arquivo corrompido: ignora na listagem
    }
  }
  models.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ models });
}

export async function POST(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let body: {
    name?: unknown;
    text?: unknown;
    sourceUrl?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const lines = cleanLyrics(text);
  if (lines.length < 5) {
    return NextResponse.json(
      {
        error:
          "Texto curto demais para treinar: são necessárias pelo menos 5 " +
          "linhas de letra.",
      },
      { status: 400 },
    );
  }
  if (lines.length > 100_000) {
    return NextResponse.json(
      { error: "Texto grande demais (máximo de 100 mil linhas)." },
      { status: 400 },
    );
  }

  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const sourceUrl =
    typeof body?.sourceUrl === "string" ? body.sourceUrl.trim().slice(0, 500) : null;

  const model = trainRhymeModel(lines, name, sourceUrl);
  model.id = randomUUID();

  await mkdir(MODELS_DIR, { recursive: true });
  await writeFile(
    path.join(MODELS_DIR, `${model.id}.json`),
    JSON.stringify(model),
    "utf8",
  );

  return NextResponse.json({ model: toMeta(model) }, { status: 201 });
}
