import { NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { assertLocalhost } from "@/lib/local_only";
import { venvPython } from "@/lib/mlx_env";
import { cleanLyrics } from "@/lib/rhyme_model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const LLM_DIR = path.join(process.cwd(), "data", "rhyme-llm");
const DEFAULT_MODEL = path.join(LLM_DIR, "_base", "gpt2-pt-medium");

export type SmartJob = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  step: number | null;
  iters: number;
  loss: number | null;
  elapsedSec: number;
  createdAt: string;
  updatedAt: string | null;
  model: string;
  error?: string | null;
};

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJob(jobDir: string): Promise<SmartJob | null> {
  try {
    const meta = JSON.parse(
      await readFile(path.join(jobDir, "job.json"), "utf8"),
    ) as SmartJob;
    try {
      const state = JSON.parse(
        await readFile(path.join(jobDir, "state.json"), "utf8"),
      ) as Partial<SmartJob>;
      return { ...meta, ...state };
    } catch {
      return meta;
    }
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let dirs: string[] = [];
  try {
    dirs = await readdir(LLM_DIR);
  } catch {
    return NextResponse.json({ jobs: [] });
  }

  const jobs: SmartJob[] = [];
  for (const dir of dirs) {
    if (!ID_RE.test(dir)) continue;
    const job = await readJob(path.join(LLM_DIR, dir));
    if (job) jobs.push(job);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let body: { name?: unknown; text?: unknown; iters?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const lines = cleanLyrics(text);
  if (lines.length < 20) {
    return NextResponse.json(
      {
        error:
          "Corpus curto demais para o fine-tune: são necessárias pelo menos " +
          "20 linhas de letra (extraia as letras ou cole um texto).",
      },
      { status: 400 },
    );
  }

  const iters =
    typeof body?.iters === "number" && Number.isFinite(body.iters)
      ? Math.min(Math.max(Math.round(body.iters), 20), 4000)
      : 2000;

  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const id = randomUUID();
  const jobDir = path.join(LLM_DIR, id);
  await mkdir(jobDir, { recursive: true });

  // Corpus e dataset locais (não versionados).
  await writeFile(path.join(jobDir, "corpus.txt"), text, "utf8");
  await execFileAsync(
    venvPython(),
    [
      "scripts/build_dataset.py",
      path.join(jobDir, "corpus.txt"),
      path.join(jobDir, "dataset"),
    ],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );

  const job: SmartJob = {
    id,
    name: name || "LLM de rimas",
    status: "running",
    step: null,
    iters,
    loss: null,
    elapsedSec: 0,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    model: DEFAULT_MODEL,
    error: null,
  };
  await writeFile(
    path.join(jobDir, "job.json"),
    JSON.stringify(job, null, 2),
    "utf8",
  );

  // Treino em processo desacoplado; o progresso fica em state.json.
  const child = spawn(
    venvPython(),
    [
      "scripts/train_mlx.py",
      "--job-dir",
      jobDir,
      "--name",
      job.name,
      "--iters",
      String(iters),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  return NextResponse.json({ job }, { status: 201 });
}
