import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertLocalhost } from "@/lib/local_only";
import { cleanLyrics } from "@/lib/rhyme_model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const YOUTUBE_URL =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts|live)([?/]|$)|youtu\.be\/)/i;

const SKIP_LINE =
  /^(WEBVTT|NOTE|STYLE|Kind:|Language:|align:|position:|line:|size:)/i;

function parseSubtitles(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || SKIP_LINE.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue; // ids numéricos (SRT)
    if (/^\d{1,2}:\d{2}/.test(trimmed)) continue; // timestamps de cue
    if (trimmed.includes("-->") || trimmed.includes(" -> ")) continue;
    out.push(trimmed);
  }
  return out.join("\n");
}

export async function POST(request: Request) {
  const guard = assertLocalhost(request);
  if (guard) return guard;

  let body: { url?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!YOUTUBE_URL.test(url)) {
    return NextResponse.json(
      { error: "Link inválido. Cole um link do YouTube." },
      { status: 400 },
    );
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "rapbeasts-subs-"));
  try {
    let stdout: string;
    try {
      const res = await execFileAsync(
        "yt-dlp",
        [
          "--skip-download",
          "--write-auto-subs",
          "--write-subs",
          "--sub-langs",
          "pt.*",
          "--sub-format",
          "vtt/srt/ttml/best",
          "--no-playlist",
          "--print",
          "%(title)s",
          "-o",
          path.join(tmp, "subs.%(ext)s"),
          url,
        ],
        { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
      );
      stdout = res.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const tail = message.split("\n").slice(-4).join(" ");
      return NextResponse.json(
        {
          error:
            "Falha ao baixar as legendas. Verifique se o vídeo tem legendas " +
            "automáticas em português." +
            (tail ? ` (${tail.slice(0, 300)})` : ""),
        },
        { status: 422 },
      );
    }

    const title =
      stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) ?? "Rimas do YouTube";

    const files = await readdir(tmp);
    const subFile = files.find((f) => /\.(vtt|srt|ttml)$/i.test(f));
    if (!subFile) {
      return NextResponse.json(
        {
          error:
            "Não encontrei legendas em português nesse vídeo. Tente outro " +
            "vídeo ou cole as letras manualmente.",
        },
        { status: 404 },
      );
    }

    const raw = await readFile(path.join(tmp, subFile), "utf8");
    const transcript = parseSubtitles(raw);
    const lines = cleanLyrics(transcript);
    if (lines.length < 5) {
      return NextResponse.json(
        { error: "A transcrição ficou curta demais para treinar." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      title,
      text: transcript,
      lineCount: lines.length,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
