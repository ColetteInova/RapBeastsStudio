"use client";

import { useState } from "react";
import {
  findSongByShareCode,
  listCommunitySongs,
  listScores,
  reportSong,
  type CloudSong,
  type ScoreEntry,
} from "@/lib/firebase";

interface CommunityPanelProps {
  onStatus: (message: string) => void;
}

const REPORT_REASONS = ["spam", "ofensivo", "copyright", "outro"];

export default function CommunityPanel({ onStatus }: CommunityPanelProps) {
  const [songs, setSongs] = useState<CloudSong[]>([]);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [scores, setScores] = useState<Record<string, ScoreEntry[]>>({});
  const [reported, setReported] = useState<Record<string, boolean>>({});

  const load = async () => {
    setBusy(true);
    try {
      setSongs(await listCommunitySongs());
      onStatus(`Vitrine carregada (${songs.length} músicas).`);
    } catch (error) {
      onStatus(
        `Falha ao carregar a vitrine: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const song = await findSongByShareCode(code);
      if (!song) {
        onStatus(`Código ${code.trim().toUpperCase()} não encontrado.`);
        return;
      }
      setSongs((previous) => [
        song,
        ...previous.filter((entry) => entry.songId !== song.songId),
      ]);
      onStatus(`Encontrado: ${song.title} (${song.songId}).`);
    } catch (error) {
      onStatus(
        `Falha na busca: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleScores = async (songId: string) => {
    if (scores[songId]) {
      setScores((previous) => ({ ...previous, [songId]: [] }));
      return;
    }
    try {
      const entries = await listScores(songId);
      setScores((previous) => ({ ...previous, [songId]: entries }));
    } catch (error) {
      onStatus(
        `Falha ao carregar placar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const report = async (songId: string, reason: string) => {
    try {
      await reportSong(songId, reason);
      setReported((previous) => ({ ...previous, [songId]: true }));
      onStatus("Denúncia enviada — obrigado.");
    } catch (error) {
      onStatus(
        `Falha ao denunciar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Comunidade (Fase 3)</h2>
      <div className="row">
        <button disabled={busy} onClick={() => void load()}>
          Buscar vitrine
        </button>
        <label className="field" style={{ flex: 1 }}>
          Código da música
          <input
            type="text"
            value={code}
            placeholder="ex.: B7K2XQ"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => void search()}>
          Buscar por código
        </button>
      </div>
      {songs.length > 0 && (
        <ul className="cloud-list">
          {songs.map((song) => (
            <li key={song.songId}>
              <div>
                <strong>{song.title}</strong>
                <span className="legend">
                  {" "}
                  · {song.authorName || "?"} · {song.type} · {song.laneCount}{" "}
                  lanes
                  {song.shareCode ? ` · código ${song.shareCode}` : ""}
                </span>
                <div className="row" style={{ margin: "4px 0 0" }}>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(song.shareCode);
                      onStatus(`Código ${song.shareCode} copiado.`);
                    }}
                  >
                    Copiar código
                  </button>
                  <button onClick={() => void toggleScores(song.songId)}>
                    {scores[song.songId]?.length ? "Fechar placar" : "Placar"}
                  </button>
                  {!reported[song.songId] ? (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) void report(song.songId, e.target.value);
                      }}
                    >
                      <option value="" disabled>
                        Denunciar…
                      </option>
                      {REPORT_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="legend">denúncia enviada</span>
                  )}
                </div>
                {scores[song.songId]?.length !== undefined &&
                  scores[song.songId].length > 0 && (
                    <ol className="score-list">
                      {scores[song.songId].map((entry, index) => (
                        <li key={`${entry.name}-${index}`}>
                          {index + 1}º · {entry.name} · {entry.score} pts · rank{" "}
                          {entry.rank} · {Math.round(entry.accuracy * 100)}% ·{" "}
                          {entry.maxCombo} combo
                        </li>
                      ))}
                    </ol>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
