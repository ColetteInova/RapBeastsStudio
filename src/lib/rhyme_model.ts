// Modelo estatístico de rimas (Markov chain + dicionário de rimas).
// Leve: roda em Node sem GPU. Os dados treinados são gravados em JSON.

export type RhymeModelStats = {
  lines: number;
  words: number;
  pairs: number;
  rhymeGroups: number;
};

export type RhymeModelMeta = {
  id: string;
  name: string;
  sourceUrl: string | null;
  createdAt: string;
  order: number;
  stats: RhymeModelStats;
};

export type RhymeModelData = RhymeModelMeta & {
  transitions: Record<string, Record<string, number>>; // "w1<sep>w2" -> { w3: count }
  follows: Record<string, Record<string, number>>; // "w1" -> { w2: count }
  vocab: Record<string, number>;
  starts: Record<string, number>; // inícios de linha
  rhymeDict: Record<string, Record<string, number>>; // chaveDeRima -> { palavraFinal: count }
};

export type GenerateOptions = {
  seed?: string;
  rhyme?: string | null;
  count?: number;
  maxLen?: number;
  rng?: () => number;
};

export const MARKOV_ORDER = 2;
const SEP = "\u0001";
const START = "<s>";
const END = "</s>";
const MAX_LEN = 14;

const WORD_SPLIT = /[^a-záâãàçéêíóôõúü'-]+/i;
const VOWEL_RUNS = /[aeiouáâãàéêíóôõúü]+/g;

export function tokenize(line: string): string[] {
  return line
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((w) => w.length > 0 && !/^[-']+$/.test(w));
}

// Chave de rima = última sequência vocálica + consoantes finais (sem
// acentos). Terminações em vogal fraca única (a/e/o) incluem a consoante
// anterior para não casar tudo com tudo.
// Ex.: "coração" -> "ao", "cantou" -> "ou", "amar" -> "ar",
//      "batida"/"vida" -> "da", "noite"/"forte" -> "te", "amor"/"dor" -> "or".
export function rhymeKeyOf(word: string): string {
  const w = tokenize(word).pop() ?? word.toLowerCase();
  const runs = w.match(VOWEL_RUNS);
  if (!runs || runs.length === 0) return stripAccents(w) || "?";
  const lastRun = runs[runs.length - 1]!;
  const idx = w.lastIndexOf(lastRun);
  let key = w.slice(idx);
  if (key === lastRun && /^[aeoâãàáéêèóôõò]$/i.test(lastRun)) {
    const prev = w[idx - 1];
    if (prev && !/[aeiouáâãàéêíóôõúü]/.test(prev)) key = prev + key;
  }
  return stripAccents(key);
}

function stripAccents(word: string): string {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeLine(line: string): string {
  return line
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[♪♫]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Converte texto bruto (legendas VTT etc.) em linhas treináveis, sem
// duplicatas consecutivas e sem linhas curtas demais.
export function cleanLyrics(text: string): string[] {
  const lines: string[] = [];
  let previous = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = normalizeLine(raw);
    if (!line || line === previous) continue;
    const words = tokenize(line);
    if (words.length < 2) continue;
    previous = line;
    lines.push(line);
  }
  return lines;
}

function bump(
  map: Record<string, Record<string, number>>,
  key: string,
  next: string,
): void {
  const inner = (map[key] ??= {});
  inner[next] = (inner[next] ?? 0) + 1;
}

export function trainRhymeModel(
  lyrics: string[],
  name: string,
  sourceUrl: string | null = null,
): RhymeModelData {
  const transitions: Record<string, Record<string, number>> = {};
  const follows: Record<string, Record<string, number>> = {};
  const vocab: Record<string, number> = {};
  const starts: Record<string, number> = {};
  const rhymeDict: Record<string, Record<string, number>> = {};

  let lineCount = 0;

  for (const line of lyrics) {
    const words = tokenize(line);
    if (words.length < 2) continue;
    lineCount++;

    const seq = [START, ...words, END];
    for (let i = 0; i + 2 < seq.length; i++) {
      bump(transitions, [seq[i], seq[i + 1]].join(SEP), seq[i + 2]);
    }
    for (let i = 0; i + 1 < seq.length; i++) {
      bump(follows, seq[i]!, seq[i + 1]!);
    }
    for (const w of seq) {
      if (w !== START && w !== END) vocab[w] = (vocab[w] ?? 0) + 1;
    }
    const startKey = [seq[0], seq[1]].join(SEP);
    starts[startKey] = (starts[startKey] ?? 0) + 1;

    const lastWord = words[words.length - 1]!;
    bump(rhymeDict, rhymeKeyOf(lastWord), lastWord);
  }

  const model: RhymeModelData = {
    id: "",
    name: name.trim() || "Modelo sem nome",
    sourceUrl,
    createdAt: new Date().toISOString(),
    order: MARKOV_ORDER,
    stats: {
      lines: lineCount,
      words: Object.keys(vocab).length,
      pairs: Object.keys(transitions).length,
      rhymeGroups: Object.keys(rhymeDict).length,
    },
    transitions,
    follows,
    vocab,
    starts,
    rhymeDict,
  };
  return model;
}

function sampleWeighted(
  weights: Record<string, number> | undefined,
  rng: () => number,
): string | null {
  if (!weights) return null;
  const entries = Object.entries(weights);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  let roll = rng() * total;
  for (const [word, n] of entries) {
    roll -= n;
    if (roll <= 0) return word;
  }
  return entries[entries.length - 1]![0];
}

function pickStart(
  model: RhymeModelData,
  seedWords: string[],
  rng: () => number,
): string[] {
  if (seedWords.length >= 2) return seedWords.slice(0, 2);
  if (seedWords.length === 1) {
    const first = seedWords[0]!;
    const next = sampleWeighted(model.follows[first] ?? model.vocab, rng);
    if (next && next !== END && next !== START) return [first, next];
    return [first];
  }
  const startKey = sampleWeighted(model.starts, rng);
  if (!startKey) return [];
  const parts = startKey.split(SEP).filter((p) => p !== START);
  return parts;
}

function nextWord(
  model: RhymeModelData,
  context: string[],
  rng: () => number,
): string | null {
  const pair = sampleWeighted(model.transitions[context.join(SEP)], rng);
  if (pair) return pair;
  const last = context[context.length - 1];
  const single = last ? sampleWeighted(model.follows[last], rng) : null;
  if (single) return single;
  return sampleWeighted(model.vocab, rng);
}

function pickRhymeWord(
  candidates: Record<string, number>,
  avoid: string,
  rng: () => number,
): string {
  const rest = Object.fromEntries(
    Object.entries(candidates).filter(([w]) => w !== avoid),
  );
  const picked = sampleWeighted(
    Object.keys(rest).length > 0 ? rest : candidates,
    rng,
  );
  return picked ?? avoid;
}

export function rhymeCandidatesOf(
  model: RhymeModelData,
  word: string,
): Record<string, number> | null {
  return model.rhymeDict[rhymeKeyOf(word)] ?? null;
}

export function generateRhymes(
  model: RhymeModelData,
  options: GenerateOptions = {},
): string[] {
  if (Object.keys(model.rhymeDict).length === 0) return [];
  const rng = options.rng ?? Math.random;
  const count = Math.min(Math.max(options.count ?? 4, 1), 16);
  const maxLen = Math.min(Math.max(options.maxLen ?? MAX_LEN, 4), 24);

  let rhymeClass: string;
  let candidates: Record<string, number>;
  if (options.rhyme) {
    candidates = rhymeCandidatesOf(model, options.rhyme) ?? {};
    if (Object.keys(candidates).length === 0) return [];
    rhymeClass = rhymeKeyOf(options.rhyme);
  } else {
    rhymeClass = sampleWeighted(
      Object.fromEntries(
        Object.entries(model.rhymeDict).map(([k, v]) => [
          k,
          Object.values(v).reduce((a, b) => a + b, 0),
        ]),
      ),
      rng,
    )!;
    candidates = model.rhymeDict[rhymeClass] ?? {};
  }

  const seedWords = options.seed ? tokenize(options.seed) : [];
  const lines: string[] = [];

  let guard = 0;
  while (lines.length < count && guard < count * 50) {
    guard++;
    const context = pickStart(model, lines.length === 0 ? seedWords : [], rng);
    const words = [...context];

    while (words.length < maxLen - 1) {
      const next = nextWord(model, words.slice(-2), rng);
      if (!next || next === END || next === START) break;
      words.push(next);
    }

    const last = words[words.length - 1] ?? "";
    if (rhymeKeyOf(last) !== rhymeClass) {
      words.push(pickRhymeWord(candidates, last, rng));
    }

    const line = words.join(" ");
    if (line.split(" ").length >= 2 && !lines.includes(line)) {
      lines.push(line);
    }
  }

  return lines;
}
