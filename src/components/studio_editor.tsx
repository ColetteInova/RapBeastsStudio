"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type { User } from "firebase/auth";
import CommunityPanel from "@/components/community_panel";
import LanePreview from "@/components/lane_preview";
import PremiumPanel from "@/components/premium_panel";
import SequencerPanel from "@/components/sequencer_panel";
import { useMetronome } from "@/components/use_metronome";
import {
  buildManifest,
  buildNormalNotes,
  gridStepMs,
  snapToGrid,
  validatePackage,
  type Marker,
  type NoteType,
  type PackageManifest,
  type Side,
  type ValidationReport,
} from "@/lib/chart";
import {
  deleteCloudSong,
  firebaseConfig,
  getFirebaseIdToken,
  listCloudSongs,
  publishSong,
  signInGoogle,
  signOutCloud,
  uploadPackageZip,
  watchAuth,
  type CloudSong,
} from "@/lib/firebase";
import { buildPackageZip } from "@/lib/package";

const ROUNDS = [1, 2, 3] as const;

export default function StudioEditor() {
  const waveRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const urlRef = useRef<string | null>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [offsetMs, setOffsetMs] = useState(0);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [newSide, setNewSide] = useState<Side>("player");
  const [newRound, setNewRound] = useState<number>(1);
  const [songId, setSongId] = useState("u_meu_chart");
  const [title, setTitle] = useState("Minha Batalha");
  const [beatRef, setBeatRef] = useState("");
  const [audioFile, setAudioFile] = useState("beat.ogg");
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [previewLaneCount, setPreviewLaneCount] = useState(5);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [audioSource, setAudioSource] = useState<{
    blob: Blob;
    name: string;
  } | null>(null);
  const [packageType, setPackageType] = useState<"chart_only" | "full_song">(
    "chart_only",
  );
  const [user, setUser] = useState<User | null>(null);
  const [cloudSongs, setCloudSongs] = useState<CloudSong[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [status, setStatus] = useState(
    "Carregue um áudio e aperte TAP (ou espaço) na batida.",
  );

  // --- Áudio (wavesurfer) -------------------------------------------------
  useEffect(() => {
    if (!audioUrl || !waveRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      url: audioUrl,
      waveColor: "#3d3a5c",
      progressColor: "#8b7bff",
      cursorColor: "#ffd23f",
      height: 140,
      barWidth: 2,
      interact: true,
    });
    wsRef.current = ws;
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setPlaying(false);
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    return () => {
      ws.destroy();
      wsRef.current = null;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setDuration(0);
      setMarkers([]);
      setSelected(null);
    };
  }, [audioUrl]);

  const loadAudioBlob = useCallback((blob: Blob, name: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setAudioSource({ blob, name });
    setAudioUrl(url);
    setStatus(`Áudio carregado: ${name}`);
  }, []);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadAudioBlob(file, file.name);
  };

  /** Decodifica o beat atual do editor (usado na mixagem premium). */
  const getBeatBuffer = useCallback(async (): Promise<AudioBuffer> => {
    if (!audioSource) throw new Error("carregue um beat primeiro");
    const context = new AudioContext();
    try {
      return await context.decodeAudioData(await audioSource.blob.arrayBuffer());
    } finally {
      void context.close();
    }
  }, [audioSource]);

  const playPause = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.pause();
    ws.setTime(0);
  }, []);

  // --- Tap ------------------------------------------------------------------
  const tap = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || duration <= 0) {
      setStatus("Carregue um áudio primeiro.");
      return;
    }
    const step = gridStepMs(bpm);
    const raw = ws.getCurrentTime() * 1000 + offsetMs;
    const snapped = snapToGrid(raw, bpm);
    const existing = markers.findIndex((m) => Math.abs(m.t - snapped) < step * 0.4);
    if (existing >= 0) {
      setSelected(existing);
      return;
    }
    const marker: Marker = {
      t: snapped,
      w: "",
      side: newSide,
      round: newRound,
      type: "tap",
      button: 0,
      holdMs: Math.max(Math.round(step * 2), 1),
    };
    const next = [...markers, marker].sort((a, b) => a.t - b.t);
    setMarkers(next);
    setSelected(next.indexOf(marker));
  }, [bpm, duration, markers, newSide, newRound, offsetMs]);

  // Tecla de espaço fora de inputs/buttons dispara o TAP.
  const tapRef = useRef(tap);
  useEffect(() => {
    tapRef.current = tap;
  }, [tap]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(target.tagName)
      ) {
        return;
      }
      event.preventDefault();
      tapRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Playhead --------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ws = wsRef.current;
      const el = playheadRef.current;
      if (ws && el) {
        const d = ws.getDuration() || 1;
        el.style.left = `${(ws.getCurrentTime() / d) * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Metrônomo e preview -----------------------------------------------------
  const getSongTime = useCallback(() => wsRef.current?.getCurrentTime() ?? 0, []);
  useMetronome(metronomeOn, playing, bpm, getSongTime);

  const getTimeMs = useCallback(
    () => (wsRef.current?.getCurrentTime() ?? 0) * 1000 + offsetMs,
    [offsetMs],
  );
  const previewNotes = useMemo(() => buildNormalNotes(markers), [markers]);

  // --- Edição de marcadores ---------------------------------------------------
  const updateMarker = (patch: Partial<Marker>) => {
    if (selected === null) return;
    setMarkers((prev) =>
      prev.map((m, i) => (i === selected ? { ...m, ...patch } : m)),
    );
  };

  const deleteSelected = () => {
    if (selected === null) return;
    setMarkers((prev) => prev.filter((_, i) => i !== selected));
    setSelected(null);
  };

  const addAdLib = () => {
    if (selected === null) return;
    updateMarker({ w: "(Ê)" });
  };

  const clearAll = () => {
    setMarkers([]);
    setSelected(null);
  };

  // --- Exportar ---------------------------------------------------------------
  const makeManifest = useCallback((): PackageManifest | null => {
    if (markers.length === 0) {
      setStatus("Adicione notas antes de exportar.");
      return null;
    }
    const manifest = buildManifest({
      songId,
      title,
      bpm,
      markers,
      beatRef,
      audioFile,
      type: packageType,
    });
    const report = validatePackage(manifest);
    setValidation(report);
    if (report.errors.length > 0) {
      setStatus("Exportação bloqueada: corrija os erros de validação.");
      return null;
    }
    return manifest;
  }, [markers, songId, title, bpm, beatRef, audioFile, packageType]);

  const onExport = () => {
    const manifest = makeManifest();
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "manifest.json";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setStatus(
      `manifest.json baixado — coloque em user://custom_songs/${manifest.song_id}/ junto do áudio.`,
    );
  };

  // --- Nuvem (Firebase, Fase 1) -------------------------------------------------
  const refreshCloud = useCallback(async () => {
    if (!firebaseConfig()) return;
    try {
      setCloudSongs(await listCloudSongs());
    } catch (error) {
      setStatus(
        `Falha ao listar a nuvem: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfig()) return;
    const unsubscribe = watchAuth((nextUser) => {
      setUser(nextUser);
      if (nextUser) void refreshCloud();
    });
    return unsubscribe;
  }, [refreshCloud]);

  const onUpload = async () => {
    const manifest = makeManifest();
    if (!manifest) return;
    setCloudBusy(true);
    try {
      const zip = await buildPackageZip(
        manifest,
        audioSource?.blob ?? null,
        audioFile,
      );
      await uploadPackageZip(manifest.song_id, zip, {
        title: manifest.title,
        type: manifest.type,
        laneCount: manifest.lane_count,
      });
      setStatus(
        `Enviado para a nuvem: ${manifest.song_id} — sincronize no jogo.`,
      );
      await refreshCloud();
    } catch (error) {
      setStatus(
        `Falha no envio: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCloudBusy(false);
    }
  };

  const onDeleteCloud = async (songId: string) => {
    try {
      await deleteCloudSong(songId);
      setStatus(`Removido da nuvem: ${songId}`);
      await refreshCloud();
    } catch (error) {
      setStatus(
        `Falha ao remover: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  /** Publica com moderação por LLM (Fase 3). */
  const onPublishToggle = async (song: CloudSong) => {
    try {
      if (!song.published) {
        const words = markers
          .map((marker) => marker.w)
          .filter((word) => word !== "")
          .join(" ");
        if (words !== "") {
          const token = await getFirebaseIdToken();
          if (!token) {
            setStatus("Entre com Google para publicar.");
            return;
          }
          const response = await fetch("/api/moderate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ text: words }),
          });
          const data = (await response.json()) as {
            flagged?: boolean;
            reason?: string;
            error?: string;
          };
          if (!response.ok) {
            setStatus(`Moderação indisponível: ${data.error ?? "erro"}`);
            return;
          }
          if (data.flagged) {
            setStatus(`Publicação bloqueada pela moderação: ${data.reason}`);
            return;
          }
        }
        const code = await publishSong(song.songId, true);
        await navigator.clipboard.writeText(code);
        setStatus(`Publicado! Código ${code} copiado.`);
      } else {
        await publishSong(song.songId, false);
        setStatus("Despublicado.");
      }
      await refreshCloud();
    } catch (error) {
      setStatus(
        `Falha ao publicar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const selectedMarker = selected !== null ? markers[selected] : null;

  return (
    <main>
      <h1>
        RapBeasts <span className="accent">Studio</span>
      </h1>
      <p className="tagline">
        Fase 0 — marque batidas por tap e exporte seu chart (Song Package v1)
      </p>

      <section className="card">
        <div className="row">
          <input type="file" accept="audio/*" onChange={onFile} />
          <label className="field">
            BPM
            <input
              type="number"
              min={40}
              max={300}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value) || 120)}
            />
          </label>
          <label className="field">
            Offset de calibração (ms)
            <input
              type="number"
              value={offsetMs}
              onChange={(e) => setOffsetMs(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div className="wave-wrap">
          <div className="wave" ref={waveRef} />
          <div className="playhead" ref={playheadRef} />
          {markers.map((marker, index) => (
            <div
              key={`${marker.t}-${index}`}
              className={`marker ${marker.side}${index === selected ? " selected" : ""}`}
              style={{ left: `${duration > 0 ? (marker.t / duration) * 100 : 0}%` }}
            >
              <div
                className="peg"
                title={`${marker.t}ms ${marker.w || "·"}`}
                onClick={() => setSelected(index)}
              />
              <div className="tail" />
            </div>
          ))}
        </div>

        <div className="row">
          <button onClick={playPause}>{playing ? "Pausa" : "Play"}</button>
          <button onClick={stop}>Parar</button>
          <button
            className={metronomeOn ? "primary" : ""}
            onClick={() => setMetronomeOn((v) => !v)}
          >
            Metrônomo {metronomeOn ? "ON" : "OFF"}
          </button>
          <button className="tap" onClick={tap}>
            TAP
          </button>
          <button onClick={addAdLib}>Ad-lib (Ê)</button>
          <button className="danger" onClick={deleteSelected}>
            Apagar nota
          </button>
          <button className="danger" onClick={clearAll}>
            Limpar tudo
          </button>
        </div>

        <div className="row">
          <label className="field">
            Lado das novas notas
            <select
              value={newSide}
              onChange={(e) => setNewSide(e.target.value as Side)}
            >
              <option value="player">player (você)</option>
              <option value="rival">rival (automático)</option>
            </select>
          </label>
          <label className="field">
            Round das novas notas
            <select
              value={newRound}
              onChange={(e) => setNewRound(Number(e.target.value))}
            >
              {ROUNDS.map((round) => (
                <option key={round} value={round}>
                  {round === 3 ? "3 (desempate)" : round}
                </option>
              ))}
            </select>
          </label>
          <span className="legend">
            <span>
              <span className="dot" style={{ background: "#ffd23f" }} />
              player
            </span>
            <span>
              <span className="dot" style={{ background: "#8b7bff" }} />
              rival
            </span>
            <span>{markers.length} notas</span>
          </span>
        </div>

        {selectedMarker && (
          <div className="row">
            <label className="field">
              Palavra (t={selectedMarker.t}ms)
              <input
                type="text"
                value={selectedMarker.w}
                placeholder="palavra da rima"
                onChange={(e) => updateMarker({ w: e.target.value })}
              />
            </label>
            <label className="field">
              Lado
              <select
                value={selectedMarker.side}
                onChange={(e) => updateMarker({ side: e.target.value as Side })}
              >
                <option value="player">player</option>
                <option value="rival">rival</option>
              </select>
            </label>
            <label className="field">
              Tipo
              <select
                value={selectedMarker.type}
                onChange={(e) =>
                  updateMarker({ type: e.target.value as NoteType })
                }
              >
                <option value="tap">tap (direcional)</option>
                <option value="trigger">trigger (botão 0–3)</option>
                <option value="hold">hold (segurar)</option>
              </select>
            </label>
            {selectedMarker.type === "trigger" && (
              <label className="field">
                Botão (0–3)
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={selectedMarker.button}
                  onChange={(e) =>
                    updateMarker({ button: Number(e.target.value) || 0 })
                  }
                />
              </label>
            )}
            {selectedMarker.type === "hold" && (
              <label className="field">
                Duração (ms)
                <input
                  type="number"
                  min={1}
                  value={selectedMarker.holdMs}
                  onChange={(e) =>
                    updateMarker({ holdMs: Number(e.target.value) || 1 })
                  }
                />
              </label>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Preview das lanes</h2>
        <div className="row">
          <label className="field">
            Lanes
            <select
              value={previewLaneCount}
              onChange={(e) => setPreviewLaneCount(Number(e.target.value))}
            >
              <option value={3}>3 lanes</option>
              <option value={4}>4 lanes</option>
              <option value={5}>5 lanes</option>
            </select>
          </label>
          <span className="legend">
            As notas caem até a linha amarela exatamente no tempo da batida
            (mesma distribuição de colunas do jogo).
          </span>
        </div>
        <LanePreview
          notes={previewNotes}
          laneCount={previewLaneCount}
          getTimeMs={getTimeMs}
        />
      </section>

      <SequencerPanel
        bpm={bpm}
        onStatus={setStatus}
        onUseBeat={(blob, name) => {
          loadAudioBlob(blob, name);
          setAudioFile(name);
        }}
      />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Exportar</h2>
        <div className="row">
          <label className="field">
            song_id
            <input
              type="text"
              value={songId}
              onChange={(e) => setSongId(e.target.value)}
            />
          </label>
          <label className="field">
            Título
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Tipo do package
            <select
              value={packageType}
              onChange={(e) =>
                setPackageType(e.target.value as "chart_only" | "full_song")
              }
            >
              <option value="chart_only">chart_only (grátis — usa beat do jogo)</option>
              <option value="full_song">full_song (premium — embarca áudio)</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            beat_ref (instrumental do jogo, opcional)
            <input
              type="text"
              value={beatRef}
              placeholder="arcade_01"
              onChange={(e) => setBeatRef(e.target.value)}
            />
          </label>
          <label className="field">
            Arquivo de áudio no package
            <input
              type="text"
              value={audioFile}
              onChange={(e) => setAudioFile(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={onExport}>
            Baixar manifest.json
          </button>
        </div>
        <div className="row">
          {!firebaseConfig() ? (
            <span className="legend">
              Nuvem não configurada — crie <code>.env.local</code> (ver{" "}
              <code>.env.local.example</code> e docs/firebase-setup.md no repo do
              jogo).
            </span>
          ) : user ? (
            <>
              <span className="legend">Logado: {user.email ?? user.uid}</span>
              <button onClick={() => void signOutCloud()}>Sair</button>
              <button
                className="primary"
                disabled={cloudBusy}
                onClick={() => void onUpload()}
              >
                {cloudBusy ? "Enviando…" : "Enviar para a nuvem"}
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => void signInGoogle()}>
              Entrar com Google
            </button>
          )}
        </div>
        {firebaseConfig() && cloudSongs.length > 0 && (
          <div>
            <p className="legend">Minhas músicas na nuvem:</p>
            <ul className="cloud-list">
              {cloudSongs.map((song) => (
                <li key={song.songId}>
                  <div>
                    <span>
                      {song.title} · {song.songId} · {song.type} ·{" "}
                      {song.laneCount} lanes
                    </span>
                    {song.published && (
                      <span className="legend">
                        {" "}
                        · publicado · código {song.shareCode}
                      </span>
                    )}
                    <div className="row" style={{ margin: "4px 0 0" }}>
                      {song.published ? (
                        <button onClick={() => void onPublishToggle(song)}>
                          Despublicar
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => void onPublishToggle(song)}
                        >
                          Publicar
                        </button>
                      )}
                      {song.published && (
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(song.shareCode);
                            setStatus(`Código ${song.shareCode} copiado.`);
                          }}
                        >
                          Copiar código
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={() => void onDeleteCloud(song.songId)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {validation?.errors.map((error) => (
          <p className="errors" key={error}>
            ✗ {error}
          </p>
        ))}
        {validation?.warnings.map((warning) => (
          <p className="warnings" key={warning}>
            ⚠ {warning}
          </p>
        ))}
      </section>

      <PremiumPanel
        bpm={bpm}
        onStatus={setStatus}
        getBeatBuffer={getBeatBuffer}
        onUseAudio={(blob, name) => {
          loadAudioBlob(blob, name);
          setAudioFile(name);
          setPackageType("full_song");
        }}
        onAddMarkers={(added) =>
          setMarkers((previous) =>
            [...previous, ...added].sort((a, b) => a.t - b.t),
          )
        }
      />

      <CommunityPanel onStatus={setStatus} />

      <p className="status">{status}</p>
    </main>
  );
}
