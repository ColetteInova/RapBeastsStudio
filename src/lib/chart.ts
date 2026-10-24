/**
 * Modelo e validação de charts — espelho do `ChartValidator`/`ChartParser`
 * do jogo (RapBeasts, scripts/core/chart_validator.gd).
 *
 * REGRA: as validações aqui devem manter paridade com as regras do jogo
 * (docs/chart-format.md §5). Se um dos lados mudar, o outro acompanha —
 * existem testes de paridade (fase 5) para pegar divergências.
 */

export type Side = "player" | "rival";
export type NoteType = "tap" | "trigger" | "hold";

export interface Note {
  /** tempo em ms — momento da batida */
  t: number;
  /** direção semântica 0=←, 1=↓, 2=↑, 3=→ */
  l: number;
  side: Side;
  /** palavra da rima (opcional; ad-libs usam parênteses) */
  w?: string;
  /** round da batalha: 1 (padrão), 2 ou 3 (desempate) */
  r?: number;
  type?: NoteType;
  /** botão 0–3 (só em trigger) */
  b?: number;
  /** duração do hold em ms (só em hold, > 0) */
  d?: number;
}

export interface DifficultyChart {
  notes: Note[];
}

export interface ChartV3 {
  format_version: number;
  song_id: string;
  title: string;
  lane_count: number;
  bpm_map: { time_ms: number; bpm: number }[];
  host_name?: string;
  host_lines: { t?: number; round?: number; text: string }[];
  difficulties: Record<string, DifficultyChart>;
}

export interface PackageManifest extends ChartV3 {
  package_version: number;
  type: "chart_only" | "full_song";
  author?: { display_name?: string };
  locale?: string;
  /** chart_only: instrumental do catálogo do jogo */
  beat_ref?: string;
  /** Fase 0: nome de arquivo relativo dentro do package */
  audio?: string;
  /** full_song: idioma → arquivo dentro do package */
  audio_files?: Record<string, string>;
}

/** Marcador no editor (antes de virar nota). */
export interface Marker {
  /** tempo quantizado em ms */
  t: number;
  w: string;
  side: Side;
  round: number;
  type: NoteType;
  button: number;
  holdMs: number;
}

export interface BuildInput {
  songId: string;
  title: string;
  bpm: number;
  markers: Marker[];
  beatRef: string;
  audioFile: string;
  /** chart_only (grátis, sem áudio embarcado) ou full_song (premium) */
  type: "chart_only" | "full_song";
}

export const VALID_SIDES: Side[] = ["player", "rival"];
export const VALID_TYPES: NoteType[] = ["tap", "trigger", "hold"];
export const LANE_COUNT_MIN = 3;
export const LANE_COUNT_MAX = 5;
export const DEFAULT_LANE_COUNT = 5;

/** Passo do grid de quantização: semicolcheia (1/16) no BPM dado. */
export function gridStepMs(bpm: number): number {
  return (60000 / bpm) / 4;
}

/** Encaixa um tempo (ms) no grid de semicolcheias. */
export function snapToGrid(t: number, bpm: number): number {
  const step = gridStepMs(bpm);
  return Math.round(t / step) * step;
}

const LANE_CYCLE = [0, 1, 2, 3];

/**
 * Coerção numérica espelhando o `int()` do GDScript (trunca; valor não
 * numérico vira 0; ausente vira o fallback). Mantém paridade com o
 * ChartValidator do jogo quando o JSON traz tipos "errados".
 */
function toInt(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : Math.trunc(n);
}

/** Distribui as lanes em ciclo por lado (espírito do layout Normal do jogo). */
function assignLanes(notes: Note[]): void {
  const counters: Record<Side, number> = { player: 0, rival: 0 };
  for (const note of notes) {
    note.l = LANE_CYCLE[counters[note.side] % LANE_CYCLE.length];
    counters[note.side] += 1;
  }
}

/** Notas da dificuldade normal derivadas dos marcadores (compartilhada com o preview). */
export function buildNormalNotes(markers: Marker[]): Note[] {
  const sorted = [...markers].sort((a, b) => a.t - b.t);
  const notes: Note[] = sorted.map((marker) => {
    const note: Note = { t: Math.round(marker.t), l: 0, side: marker.side };
    const word = marker.w.trim();
    if (word !== "") note.w = word;
    if (marker.round !== 1) note.r = marker.round;
    if (marker.type === "trigger") {
      note.type = "trigger";
      note.b = Math.min(Math.max(Math.round(marker.button), 0), 3);
    } else if (marker.type === "hold") {
      note.type = "hold";
      note.d = Math.max(1, Math.round(marker.holdMs));
    }
    return note;
  });
  assignLanes(notes);
  return notes;
}

/**
 * Coluna visual (espelho de `LaneLayout.normal_display_lane` do jogo):
 * 5 lanes: direções 0–3 + ações na 4 · 4 lanes: ←/↑ | ↓/→ | ações X/Y | ações A/B
 * · 3 lanes: ←/↑ | ↓/→ | ações.
 */
export function displayLane(
  note: Pick<Note, "l" | "type" | "b">,
  laneCount: number,
): number {
  const count = Math.min(Math.max(laneCount, LANE_COUNT_MIN), LANE_COUNT_MAX);
  if (note.type === "trigger") {
    if (count === 3) return 2;
    if (count === 4) return note.b === 0 || note.b === 3 ? 2 : 3;
    return 4;
  }
  const direction = Math.min(Math.max(toInt(note.l, 0), 0), 3);
  if (count < DEFAULT_LANE_COUNT) {
    return direction === 0 || direction === 2 ? 0 : 1;
  }
  return direction;
}

export function buildManifest(input: BuildInput): PackageManifest {
  const normalNotes = buildNormalNotes(input.markers);
  // easy: 1 comando a cada 2 palavras · hard: espelho do normal (subdivisão
  // por sílaba é um passo futuro do editor).
  const easyNotes = normalNotes.filter((_, index) => index % 2 === 0);
  const hardNotes = normalNotes.map((note) => ({ ...note }));

  const manifest: PackageManifest = {
    package_version: 1,
    format_version: 3,
    type: input.type,
    song_id: input.songId.trim() || "u_meu_chart",
    title: input.title.trim() || "Meu Chart",
    lane_count: DEFAULT_LANE_COUNT,
    locale: "pt",
    bpm_map: [{ time_ms: 0, bpm: input.bpm }],
    host_name: "DJ JABAY",
    host_lines: [],
    difficulties: {
      easy: { notes: easyNotes },
      normal: { notes: normalNotes },
      hard: { notes: hardNotes },
    },
  };
  if (input.type === "full_song") {
    manifest.audio_files = { pt: input.audioFile, en: input.audioFile };
  } else {
    manifest.beat_ref = input.beatRef.trim();
    manifest.audio = input.audioFile.trim();
  }
  return manifest;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

/**
 * Espelho de `ChartValidator.validate(..., require_audio = false)` +
 * checagens do contrato Song Package v1 (docs/studio-app.md §4).
 */
export function validatePackage(
  manifest: PackageManifest,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Contrato do package
  const packageVersion = toInt(manifest.package_version, -1);
  if (packageVersion !== 1) {
    errors.push(`package_version não suportado: ${packageVersion}`);
  }
  if (manifest.type !== "chart_only" && manifest.type !== "full_song") {
    errors.push(`type inválido: ${String(manifest.type)}`);
  }
  if (manifest.type === "full_song" && !manifest.audio_files) {
    errors.push("full_song exige audio_files");
  }

  // Espelho do ChartValidator
  const formatVersion = toInt(manifest.format_version, -1);
  if (![2, 3].includes(formatVersion)) {
    errors.push(`format_version não suportado: ${formatVersion}`);
  }
  if (typeof manifest.song_id !== "string" || manifest.song_id === "") {
    errors.push("song_id ausente");
  }
  if (typeof manifest.title !== "string" || manifest.title === "") {
    errors.push("title ausente");
  }
  const laneCount = toInt(manifest.lane_count, DEFAULT_LANE_COUNT);
  if (laneCount < LANE_COUNT_MIN || laneCount > LANE_COUNT_MAX) {
    errors.push("lane_count deve estar entre 3 e 5");
  }
  const bpmMap = manifest.bpm_map ?? [];
  if (bpmMap.length === 0) {
    errors.push("bpm_map vazio");
  } else {
    let last = -1;
    for (const entry of bpmMap) {
      const timeMs = toInt(entry.time_ms, -1);
      if (timeMs < last) {
        errors.push("bpm_map fora de ordem");
        break;
      }
      last = timeMs;
    }
    if (toInt(bpmMap[0].time_ms, -1) !== 0) {
      errors.push("bpm_map deve começar em 0");
    }
  }
  const difficulties = manifest.difficulties ?? {};
  if (Object.keys(difficulties).length === 0) {
    errors.push("sem dificuldades");
  }
  for (const [difficulty, chart] of Object.entries(difficulties)) {
    const notes = chart?.notes ?? [];
    let previousT = -1;
    let firstT = -1;
    const holds = new Map<number, [number, number]>();
    const usedLanes = new Set<number>();
    const laneAtTime = new Map<number, number>();
    for (const raw of notes) {
      if (raw === null || typeof raw !== "object") {
        errors.push(`${difficulty} — nota inválida`);
        continue;
      }
      const t = toInt(raw.t, -1);
      const lane = toInt(raw.l, -1);
      const side = raw.side;
      const type: NoteType = raw.type ?? "tap";
      if (firstT < 0) firstT = t;
      if (t < 0) {
        errors.push(`${difficulty} — t inválido (${t})`);
      }
      if (t < previousT) {
        errors.push(`${difficulty} — notas fora de ordem (t=${t})`);
      }
      if (t === previousT && laneAtTime.get(t) === lane) {
        warnings.push(`${difficulty} — nota duplicada na mesma lane (t=${t})`);
      }
      if (t >= 0) {
        laneAtTime.set(t, lane);
      }
      if (lane < 0 || lane >= 4) {
        errors.push(`${difficulty} — lane inválida (${lane})`);
      }
      if (!VALID_SIDES.includes(side)) {
        errors.push(`${difficulty} — side inválido (${String(side)})`);
      }
      if (!VALID_TYPES.includes(type)) {
        errors.push(`${difficulty} — type inválido (${String(type)})`);
      }
      if (type === "trigger") {
        const b = toInt(raw.b, -1);
        if (b < 0 || b > 3) {
          errors.push(`${difficulty} — trigger sem b válido (0–3)`);
        }
      }
      if (type === "hold") {
        const d = toInt(raw.d, 0);
        if (d <= 0) {
          errors.push(`${difficulty} — hold sem d > 0`);
        } else {
          const previousHold = holds.get(lane);
          if (previousHold && t < previousHold[0] + previousHold[1]) {
            errors.push(`${difficulty} — hold sobreposto na lane ${lane}`);
          }
          holds.set(lane, [t, d]);
        }
      }
      if (previousT >= 0 && t - previousT > 4000) {
        warnings.push(`${difficulty} — lacuna silenciosa > 4s (t=${t})`);
      }
      usedLanes.add(lane);
      previousT = t;
    }
    for (let lane = 0; lane < 4; lane++) {
      if (!usedLanes.has(lane)) {
        warnings.push(`${difficulty} — lane ${lane} nunca usada`);
      }
    }
    if (firstT >= 0 && firstT < 2000) {
      warnings.push(
        `${difficulty} — primeira nota em ${firstT}ms; reserve ~2s de lead-in antes da primeira nota`,
      );
    }
  }
  for (const line of manifest.host_lines ?? []) {
    const t = toInt(line.t, -1);
    const round = toInt(line.round, 0);
    if ((t < 0 && round <= 0) || line.text === "") {
      errors.push("host_line precisa de t ou round");
    }
  }
  return { errors, warnings };
}
