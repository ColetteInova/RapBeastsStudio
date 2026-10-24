"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRESETS,
  TRACK_NAMES,
  audioBufferToWavBlob,
  clapHit,
  downloadBlob,
  hatHit,
  kickHit,
  renderPatternToBuffer,
  sixteenthMs,
  snareHit,
  type Pattern,
  type TrackName,
} from "@/lib/audio";

interface SequencerPanelProps {
  bpm: number;
  onStatus: (message: string) => void;
  /** usa o beat renderizado como áudio do editor */
  onUseBeat: (blob: Blob, name: string) => void;
}

export default function SequencerPanel({
  bpm,
  onStatus,
  onUseBeat,
}: SequencerPanelProps) {
  const [pattern, setPattern] = useState<Pattern>(() => PRESETS[0].pattern);
  const [presetName, setPresetName] = useState(PRESETS[0].name);
  const [bars, setBars] = useState(2);
  const [swing, setSwing] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const stepRef = useRef(0);
  const nextTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPreview = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  const startPreview = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    void ctx.resume();
    stepRef.current = 0;
    nextTimeRef.current = ctx.currentTime + 0.06;
    const tick = () => {
      const stepMs = sixteenthMs(bpm);
      while (nextTimeRef.current < ctx.currentTime + 0.12) {
        const at = nextTimeRef.current;
        const slot = stepRef.current % 16;
        if (pattern.kick[slot]) kickHit(ctx, at);
        if (pattern.snare[slot]) snareHit(ctx, at);
        if (pattern.clap[slot]) clapHit(ctx, at);
        if (pattern.hat[slot]) hatHit(ctx, at);
        stepRef.current += 1;
        const nextSlot = stepRef.current % 16;
        const swingFactor = nextSlot % 2 === 1 ? 1 + swing * 0.5 : 1;
        nextTimeRef.current += (stepMs * swingFactor) / 1000;
      }
    };
    intervalRef.current = setInterval(tick, 25);
    setPlaying(true);
  };

  const toggle = (track: TrackName, slot: number) => {
    setPattern((previous) => {
      const next: Pattern = {
        ...previous,
        [track]: previous[track].map((value, index) =>
          index === slot ? !value : value,
        ),
      };
      return next;
    });
  };

  const applyPreset = (name: string) => {
    const preset = PRESETS.find((entry) => entry.name === name);
    if (!preset) return;
    setPresetName(name);
    setPattern({
      kick: [...preset.pattern.kick],
      snare: [...preset.pattern.snare],
      clap: [...preset.pattern.clap],
      hat: [...preset.pattern.hat],
    });
  };

  const render = async () => {
    setBusy(true);
    try {
      const buffer = await renderPatternToBuffer(pattern, bpm, swing, bars);
      const blob = audioBufferToWavBlob(buffer);
      const name = `beat_${bpm}bpm_${bars}bars.wav`;
      downloadBlob(blob, name);
      onUseBeat(blob, name);
      onStatus(`Beat renderizado: ${name} — áudio do editor atualizado.`);
    } catch (error) {
      onStatus(
        `Falha ao renderizar: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Sequenciador (criar ritmo)</h2>
      <div className="row">
        <label className="field">
          Preset
          <select
            value={presetName}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {PRESETS.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Compassos
          <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          Swing ({swing.toFixed(1)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
          />
        </label>
        <button onClick={playing ? stopPreview : startPreview}>
          {playing ? "Parar" : "Play (preview)"}
        </button>
        <button className="primary" disabled={busy} onClick={() => void render()}>
          {busy ? "Renderizando…" : "Renderizar WAV e usar como beat"}
        </button>
      </div>
      <div className="seq-grid">
        <span className="seq-label" />
        {Array.from({ length: 16 }, (_, slot) => (
          <span
            key={`head-${slot}`}
            className={`seq-label ${slot % 4 === 0 ? "beat" : ""}`}
          >
            {slot % 4 === 0 ? slot / 4 + 1 : ""}
          </span>
        ))}
        {TRACK_NAMES.map((track) => (
          <>
            <span key={`label-${track.key}`} className="seq-label">
              {track.label}
            </span>
            {pattern[track.key].map((active, slot) => (
              <button
                key={`${track.key}-${slot}`}
                className={`seq-step${active ? ` active-${track.key}` : ""}${slot % 4 === 0 ? " beat" : ""}`}
                aria-label={`${track.label} passo ${slot + 1}`}
                onClick={() => toggle(track.key, slot)}
              />
            ))}
          </>
        ))}
      </div>
      <p className="legend">
        Sons sintetizados no navegador (sem amostras externas) · BPM do editor:
        {` ${bpm}`} · padrão de 16 passos = 1 compasso.
      </p>
    </section>
  );
}
