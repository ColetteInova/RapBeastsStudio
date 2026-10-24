/**
 * Áudio premium: síntese de bateria, render de patterns, encoder WAV,
 * fatiamento e mixagem beat + vocais. Tudo client-side (OfflineAudioContext).
 *
 * Os testes unitários (scripts/audio_test.ts) cobrem as partes puras
 * (timing com swing, header WAV, presets) — OfflineAudioContext não existe
 * no Node, então o render em si é verificado no navegador.
 */

export const PATTERN_STEPS = 16;

export interface Pattern {
  kick: boolean[];
  snare: boolean[];
  clap: boolean[];
  hat: boolean[];
}

export type TrackName = keyof Pattern;

export const TRACK_NAMES: Array<{ key: TrackName; label: string }> = [
  { key: "kick", label: "BUMBO" },
  { key: "snare", label: "CAIXA" },
  { key: "clap", label: "PALMA" },
  { key: "hat", label: "CHIMBAL" },
];

export function emptyPattern(): Pattern {
  return {
    kick: Array(PATTERN_STEPS).fill(false),
    snare: Array(PATTERN_STEPS).fill(false),
    clap: Array(PATTERN_STEPS).fill(false),
    hat: Array(PATTERN_STEPS).fill(false),
  };
}

function fromBits(bits: number[]): boolean[] {
  return bits.map((bit) => bit !== 0);
}

export interface PatternPreset {
  name: string;
  pattern: Pattern;
}

export const PRESETS: PatternPreset[] = [
  {
    name: "Boom bap",
    pattern: {
      kick: fromBits([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      snare: fromBits([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
      clap: fromBits([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      hat: fromBits([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]),
    },
  },
  {
    name: "Trap",
    pattern: {
      kick: fromBits([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
      snare: fromBits([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
      clap: fromBits([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      hat: fromBits([1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1]),
    },
  },
  {
    name: "Funk suingado",
    pattern: {
      kick: fromBits([1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      snare: fromBits([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
      clap: fromBits([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]),
      hat: fromBits([1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1]),
    },
  },
];

/** Duração de uma semicolcheia em ms. */
export function sixteenthMs(bpm: number): number {
  return (60000 / bpm) / 4;
}

/** Tempo de início do step em ms (swing atrasa os 16ths ímpares). */
export function stepStartMs(step: number, bpm: number, swing: number): number {
  const base = step * sixteenthMs(bpm);
  const delay =
    step % 2 === 1 ? swing * sixteenthMs(bpm) * 0.5 : 0;
  return base + delay;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function burst(
  ctx: BaseAudioContext,
  at: number,
  source: AudioBuffer,
  filter: BiquadFilterNode,
  gain: GainNode,
  attack: number,
  decay: number,
  level: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = source;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + attack + decay);
  src.start(at);
  src.stop(at + attack + decay + 0.02);
}

export function kickHit(ctx: BaseAudioContext, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  gain.gain.setValueAtTime(0.9, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.4);
}

export function snareHit(ctx: BaseAudioContext, at: number): void {
  const noise = noiseBuffer(ctx, 0.2);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  band.Q.value = 1;
  const gain = ctx.createGain();
  burst(ctx, at, noise, band, gain, 0.001, 0.18, 0.5);
  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(190, at);
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0.35, at);
  toneGain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  tone.connect(toneGain);
  toneGain.connect(ctx.destination);
  tone.start(at);
  tone.stop(at + 0.12);
}

export function clapHit(ctx: BaseAudioContext, at: number): void {
  const noise = noiseBuffer(ctx, 0.05);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1300;
  band.Q.value = 2;
  for (let burstIndex = 0; burstIndex < 3; burstIndex++) {
    const gain = ctx.createGain();
    const offset = at + burstIndex * 0.012;
    const level = 0.5 - burstIndex * 0.12;
    burst(ctx, offset, noise, band, gain, 0.001, 0.05, level);
  }
}

export function hatHit(ctx: BaseAudioContext, at: number): void {
  const noise = noiseBuffer(ctx, 0.06);
  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 7000;
  const gain = ctx.createGain();
  burst(ctx, at, noise, high, gain, 0.001, 0.05, 0.22);
}

/** Renderiza o pattern em um AudioBuffer estéreo (OfflineAudioContext). */
export async function renderPatternToBuffer(
  pattern: Pattern,
  bpm: number,
  swing: number,
  bars: number,
): Promise<AudioBuffer> {
  const steps = bars * PATTERN_STEPS;
  const seconds = (steps * sixteenthMs(bpm)) / 1000 + 0.5;
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(seconds * 44100),
    44100,
  );
  for (let step = 0; step < steps; step++) {
    const at = stepStartMs(step, bpm, swing) / 1000;
    const slot = step % PATTERN_STEPS;
    if (pattern.kick[slot]) kickHit(ctx, at);
    if (pattern.snare[slot]) snareHit(ctx, at);
    if (pattern.clap[slot]) clapHit(ctx, at);
    if (pattern.hat[slot]) hatHit(ctx, at);
  }
  return ctx.startRendering();
}

/** Interface mínima para o encoder WAV (AudioBuffer real satisfaz). */
export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Encoder WAV PCM 16-bit (o jogo lê WAV nativamente). */
export function audioBufferToWavBlob(buffer: AudioBufferLike): Blob {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const blockAlign = channels * 2;
  const dataSize = length * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

/** Fatia um trecho de um AudioBuffer. */
export function sliceBuffer(
  source: AudioBuffer,
  startSec: number,
  durationSec: number,
): AudioBuffer {
  const rate = source.sampleRate;
  const start = Math.max(0, Math.floor(startSec * rate));
  const count = Math.max(1, Math.floor(durationSec * rate));
  const out = new AudioBuffer({
    length: count,
    numberOfChannels: source.numberOfChannels,
    sampleRate: rate,
  });
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = source.getChannelData(c);
    out.copyToChannel(data.subarray(start, start + count), c);
  }
  return out;
}

export interface WordSlice {
  /** buffer da linha de voz inteira */
  buffer: AudioBuffer;
  /** trecho da palavra dentro do buffer (segundos) */
  startSec: number;
  endSec: number;
  /** instante do chart onde a palavra deve soar (ms, já no grid) */
  atMs: number;
}

/**
 * Mixa beat + palavras fatiadas: cada palavra é encaixada exatamente na sua
 * nota do grid (o chart e o áudio casam), com fades anti-clique.
 */
export async function mixToBuffer(
  beat: AudioBuffer,
  words: WordSlice[],
): Promise<AudioBuffer> {
  const endSeconds = Math.max(
    beat.duration,
    ...words.map((word) => word.atMs / 1000 + (word.endSec - word.startSec)),
  );
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil((endSeconds + 0.4) * 44100),
    44100,
  );
  const beatSource = ctx.createBufferSource();
  beatSource.buffer = beat;
  beatSource.connect(ctx.destination);
  beatSource.start(0);
  for (const word of words) {
    const at = word.atMs / 1000;
    const duration = Math.max(0.005, word.endSec - word.startSec);
    const source = ctx.createBufferSource();
    source.buffer = sliceBuffer(word.buffer, word.startSec, duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(1, at + 0.004);
    gain.gain.setValueAtTime(1, Math.max(at + 0.005, at + duration - 0.006));
    gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(at);
  }
  return ctx.startRendering();
}

export function downloadBlob(blob: Blob, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
