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

async function fetchVideoTitle(url: string): Promise<string> {
  try {
    const res = await execFileAsync(
      "yt-dlp",
      ["--skip-download", "--no-warnings", "--no-playlist", "--print", "%(title)s", url],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const title = res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return title || "Rimas do YouTube";
  } catch {
    return "Rimas do YouTube";
  }
}

const SKIP_LINE =
  /^(WEBVTT|NOTE|STYLE|Kind:|Language:|align:|position:|line:|size:)/i;

const HTML_ENTITIES: Array<[RegExp, string]> = [
  [/&gt;/g, ">"],
  [/&lt;/g, "<"],
  [/&amp;/g, "&"],
  [/&quot;/g, '"'],
  [/&#0?39;|&apos;/g, "'"],
];

function decodeEntities(text: string): string {
  for (const [pattern, replacement] of HTML_ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function parseSubtitles(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || SKIP_LINE.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue; // ids numéricos (SRT)
    if (/^\d{1,2}:\d{2}/.test(trimmed)) continue; // timestamps de cue
    if (trimmed.includes("-->") || trimmed.includes(" -> ")) continue;
    out.push(decodeEntities(trimmed));
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
    // Fallback sequencial: um idioma por execução. Listas multi-idioma fazem
    // o yt-dlp descartar os arquivos já baixados quando um idioma falha
    // (rate limit do YouTube).
    // Atenção: "--print" implica simulate e suprime a escrita dos arquivos,
    // então o título é obtido numa chamada separada.
    const LANGS = ["pt-BR", "pt-PT", "pt"] as const;
    let lastError: string | null = null;
    let subFiles: string[] = [];

    for (const lang of LANGS) {
      try {
        await execFileAsync(
          "yt-dlp",
          [
            "--skip-download",
            "--write-auto-subs",
            "--write-subs",
            "--sub-langs",
            lang,
            "--sub-format",
            "vtt/srt/ttml/best",
            "--no-playlist",
            "-o",
            path.join(tmp, "subs.%(ext)s"),
            url,
          ],
          { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : "erro desconhecido";
      }
      const files = await readdir(tmp);
      subFiles = files.filter((f) => /\.(vtt|srt|ttml)$/i.test(f));
      if (subFiles.length > 0) break;
    }

    const title = await fetchVideoTitle(url);

    const subFile =
      subFiles.find((f) => /pt-BR/i.test(f)) ??
      subFiles.find((f) => /pt-PT/i.test(f)) ??
      subFiles.find((f) => /pt/i.test(f)) ??
      subFiles[0];
    if (!subFile) {
      const tail = lastError
        ? lastError.split("\n").filter(Boolean).slice(-3).join(" ")
        : "";
      return NextResponse.json(
        {
          error:
            "Não encontrei legendas em português nesse vídeo. Tente outro " +
            "vídeo ou cole as letras manualmente." +
            (tail ? ` (${tail.slice(0, 300)})` : ""),
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
