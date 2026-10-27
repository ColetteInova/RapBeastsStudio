import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertLocalhost } from "@/lib/local_only";
import { venvPython } from "@/lib/mlx_env";
import { rhymeKeyOf } from "@/lib/rhyme_model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const LLM_DIR = path.join(process.cwd(), "data", "rhyme-llm");
const DEFAULT_MODEL = path.join(LLM_DIR, "_base", "gpt2-pt-medium");

const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let body: {
    jobId?: unknown;
    rhyme?: unknown;
    seed?: unknown;
    count?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!ID_RE.test(jobId)) {
    return NextResponse.json({ error: "Job inválido." }, { status: 400 });
  }

  const jobDir = path.join(LLM_DIR, jobId);
  const adapter = path.join(jobDir, "adapters.safetensors");
  try {
    await stat(adapter);
  } catch {
    return NextResponse.json(
      { error: "Esse modelo ainda não tem adapter treinado." },
      { status: 404 },
    );
  }

  const rhyme =
    typeof body?.rhyme === "string" ? body.rhyme.trim().slice(0, 60) : "";
  const seed =
    typeof body?.seed === "string" ? body.seed.trim().slice(0, 200) : "";
  const count =
    typeof body?.count === "number" && Number.isFinite(body.count)
      ? Math.min(Math.max(Math.round(body.count), 1), 8)
      : 4;

  // Dicionário de rimas do corpus do job: garante a rima exata trocando a
  // palavra final das linhas geradas quando o LLM não obedece.
  const rhymeMap = new Map<string, string[]>();
  const corpusLines: string[] = [];
  if (rhyme) {
    try {
      const corpus = await readFile(path.join(jobDir, "corpus.txt"), "utf8");
      for (const line of corpus.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.split(/\s+/).length < 2) continue;
        corpusLines.push(trimmed);
        const words = trimmed.split(/\s+/);
        const last = words[words.length - 1]!;
        const key = rhymeKeyOf(last);
        const list = rhymeMap.get(key) ?? [];
        if (!list.includes(last)) list.push(last);
        rhymeMap.set(key, list);
      }
    } catch {
      /* corpus ausente: segue sem correção */
    }
  }

  // Semente automática: completa uma linha real do corpus que termina com a
  // rima alvo — saída muito mais coerente que geração fria.
  let effectiveSeed = seed;
  if (rhyme && !effectiveSeed && corpusLines.length > 0) {
    const targetKey = rhymeKeyOf(rhyme);
    const matching = corpusLines.filter(
      (line) =>
        rhymeKeyOf(line.trim().split(/\s+/).pop() ?? "") === targetKey,
    );
    if (matching.length > 0) {
      const first = matching[Math.floor(Math.random() * matching.length)]!;
      const words = first.trim().split(/\s+/);
      effectiveSeed = words.slice(0, Math.min(words.length - 1, 6)).join(" ");
    }
  }

  // Filtro de qualidade: sem dígitos isolados nem linhas curtas demais.
  const isGoodLine = (line: string) =>
    line.trim().split(/\s+/).length >= 3 && !/[0-9]/.test(line);

  try {
    // O modelo pequeno às vezes para cedo; acumula linhas únicas em até 4
    // tentativas até atingir a contagem pedida.
    const collected: string[] = [];
    for (let attempt = 0; attempt < 4 && collected.length < count; attempt++) {
      const { stdout } = await execFileAsync(
        venvPython(),
        [
          "scripts/generate_mlx.py",
          "--adapter",
          adapter,
          "--rhyme",
          rhyme,
          "--seed-text",
          effectiveSeed,
          "--count",
          String(count),
          "--model",
          DEFAULT_MODEL,
        ],
        { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as { lines?: string[]; error?: string };
      if (parsed.error) {
        return NextResponse.json({ error: parsed.error }, { status: 422 });
      }
      for (const line of parsed.lines ?? []) {
        if (isGoodLine(line) && !collected.includes(line)) collected.push(line);
      }
    }
    let lines = collected;

    if (rhyme && lines.length > 0) {
      const targetKey = rhymeKeyOf(rhyme);
      const candidates = rhymeMap.get(targetKey);
      if (!candidates || candidates.length === 0) {
        return NextResponse.json(
          {
            error:
              `Não achei rimas para "${rhyme}" no corpus desse modelo. ` +
              "Tente outra palavra.",
          },
          { status: 400 },
        );
      }
      lines = lines.map((line) => {
        const words = line.trim().split(/\s+/);
        const last = words[words.length - 1];
        if (!last || rhymeKeyOf(last) === targetKey) return line;
        const alternatives = candidates.filter(
          (w) => w !== last && w.length >= 3,
        );
        const pool = alternatives.length > 0 ? alternatives : candidates;
        const picked = pool[Math.floor(Math.random() * pool.length)]!;
        return [...words.slice(0, -1), picked].join(" ");
      });
    }
    return NextResponse.json({ lines: lines.slice(0, count) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const tail = message.split("\n").filter(Boolean).slice(-3).join(" ");
    return NextResponse.json(
      { error: "Falha na geração LLM." + (tail ? ` (${tail.slice(0, 300)})` : "") },
      { status: 422 },
    );
  }
}
