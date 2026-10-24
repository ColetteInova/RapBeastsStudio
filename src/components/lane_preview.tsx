"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { displayLane, type Note } from "@/lib/chart";

interface LanePreviewProps {
  notes: Note[];
  laneCount: number;
  /** tempo atual da música em ms (raw + offset) */
  getTimeMs: () => number;
}

const HEIGHT = 400;
const HIT_MARGIN = 44;
const WINDOW_MS = 2000;

/**
 * Mini-simulador das lanes do jogo: notas caem até a linha de acerto,
 * alcançando-a exatamente no `t` da nota. Colunas seguem
 * `LaneLayout.normal_display_lane` (espelho no chart.ts) para 3/4/5 lanes.
 */
export default function LanePreview({
  notes,
  laneCount,
  getTimeMs,
}: LanePreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const noteEls = useRef(new Map<number, HTMLDivElement>());
  const [boxWidth, setBoxWidth] = useState(900);

  const rendered = useMemo(
    () =>
      notes.map((note, index) => ({
        index,
        t: note.t,
        col: displayLane(note, laneCount),
        side: note.side,
        w: note.w ?? "",
        type: note.type ?? "tap",
        d: note.type === "hold" && note.d ? note.d : 0,
      })),
    [notes, laneCount],
  );

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBoxWidth(entry.contentRect.width);
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pxPerMs = (HEIGHT - HIT_MARGIN) / WINDOW_MS;
    let raf = 0;
    const tick = () => {
      const now = getTimeMs();
      for (const item of rendered) {
        const el = noteEls.current.get(item.index);
        if (!el) continue;
        const top = HEIGHT - HIT_MARGIN - (item.t - now) * pxPerMs;
        if (top < -60 || top > HEIGHT + 20) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.top = `${top}px`;
        el.style.left = `${(item.col / laneCount) * boxWidth}px`;
        el.style.width = `${boxWidth / laneCount}px`;
        const tail = el.querySelector<HTMLElement>("[data-tail]");
        if (tail) tail.style.height = `${item.d * pxPerMs}px`;
        el.classList.toggle("hitting", Math.abs(item.t - now) < 90);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rendered, laneCount, boxWidth, getTimeMs]);

  return (
    <div className="lane-preview" ref={boxRef}>
      <div className="lane-hit" style={{ top: HEIGHT - HIT_MARGIN }} />
      {Array.from({ length: laneCount - 1 }, (_, i) => (
        <div
          key={`sep-${i}`}
          className="lane-sep"
          style={{ left: `${((i + 1) / laneCount) * 100}%` }}
        />
      ))}
      {rendered.map((item) => (
        <div
          key={`note-${item.index}`}
          ref={(el) => {
            if (el) noteEls.current.set(item.index, el);
            else noteEls.current.delete(item.index);
          }}
          className={`lane-note ${item.side}${item.type === "trigger" ? " trigger" : ""}`}
          style={{ display: "none" }}
        >
          <span className="lane-note-word">{item.w}</span>
          {item.d > 0 && <span className="lane-note-tail" data-tail />}
        </div>
      ))}
    </div>
  );
}
