/**
 * Auto-alinhamento premium: timestamps de palavra (TTS da ElevenLabs) viram
 * notas no grid do chart. O centro de cada palavra encaixa na semicolcheia
 * mais próxima (como o tap manual, mas automático).
 */
import { gridStepMs, type Marker, type Side } from "@/lib/chart";

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CharacterAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

/** Agrupa o alignment por caractere em palavras (espaços separam). */
export function wordsFromAlignment(
  alignment: CharacterAlignment | null | undefined,
): WordTiming[] {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words: WordTiming[] = [];
  let current = "";
  let startSec = -1;
  let endSec = -1;
  const flush = () => {
    const text = current.trim();
    const clean = text.replace(/[^\p{L}\p{N}()'’\-]/gu, "");
    if (clean !== "" && startSec >= 0) {
      words.push({
        text,
        startMs: Math.round(startSec * 1000),
        endMs: Math.round(endSec * 1000),
      });
    }
    current = "";
    startSec = -1;
    endSec = -1;
  };
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === " ") {
      flush();
      continue;
    }
    if (startSec < 0) startSec = starts[i] ?? 0;
    endSec = ends[i] ?? starts[i] ?? 0;
    current += char;
  }
  flush();
  return words;
}

/** Encaixa as palavras no grid; colisões empurram para a semicolcheia seguinte. */
export function alignWordsToGrid(
  words: WordTiming[],
  bpm: number,
  side: Side,
): Marker[] {
  const step = gridStepMs(bpm);
  const used = new Set<number>();
  const markers: Marker[] = [];
  for (const word of words) {
    const center = (word.startMs + word.endMs) / 2;
    let t = Math.round(center / step) * step;
    while (used.has(t)) {
      t += step;
    }
    used.add(t);
    const text = word.text
      .replace(/[^\p{L}\p{N}()'’\-]/gu, "")
      .toUpperCase();
    if (text === "") continue;
    markers.push({
      t,
      w: text,
      side,
      round: 1,
      type: "tap",
      button: 0,
      holdMs: Math.max(Math.round(step * 2), 1),
    });
  }
  return markers.sort((a, b) => a.t - b.t);
}
