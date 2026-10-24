"use client";

import { useEffect, useRef } from "react";

function click(ctx: AudioContext, at: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 1000 : 700;
  gain.gain.setValueAtTime(accent ? 0.3 : 0.18, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.07);
}

/**
 * Metrônomo por lookahead scheduling ancorado no tempo da música
 * (`getSongTime` em segundos). Marca cada batida e acentua o 1 de cada 4.
 * Não depende do AudioContext do wavesurfer: agenda cliques relativos a
 * "agora", então qualquer drift é corrigido a cada tick de 25ms.
 */
export function useMetronome(
  enabled: boolean,
  playing: boolean,
  bpm: number,
  getSongTime: () => number,
): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const nextBeatRef = useRef(-1);
  const beatIndexRef = useRef(0);

  useEffect(() => {
    if (!enabled || !playing) {
      nextBeatRef.current = -1;
      return;
    }
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    const step = 60 / bpm;
    const interval = setInterval(() => {
      if (ctx.state === "suspended") void ctx.resume();
      const now = getSongTime();
      if (nextBeatRef.current < 0) {
        const phase = now / step;
        nextBeatRef.current = Math.ceil(phase - 0.0001) * step;
        beatIndexRef.current = Math.max(0, Math.floor(phase));
      }
      const lookahead = 0.12;
      while (nextBeatRef.current < now + lookahead) {
        const beatSongTime = nextBeatRef.current;
        const delay = Math.max(0, beatSongTime - now);
        const accent = beatIndexRef.current % 4 === 0;
        click(ctx, ctx.currentTime + delay, accent);
        nextBeatRef.current += step;
        beatIndexRef.current += 1;
      }
    }, 25);
    return () => clearInterval(interval);
  }, [enabled, playing, bpm, getSongTime]);
}
