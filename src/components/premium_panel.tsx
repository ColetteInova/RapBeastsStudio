"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { Marker } from "@/lib/chart";
import {
  alignWordsToGrid,
  wordsFromAlignment,
  type CharacterAlignment,
  type WordTiming,
} from "@/lib/align";
import type { LyricLine } from "@/lib/ai";
import {
  audioBufferToWavBlob,
  downloadBlob,
  mixToBuffer,
  type WordSlice,
} from "@/lib/audio";
import {
  getFirebaseIdToken,
  watchAuth,
  watchEntitlement,
  type EntitlementInfo,
} from "@/lib/firebase";

interface PremiumPanelProps {
  bpm: number;
  /** adiciona marcadores no editor (já ordenados pelo editor) */
  onAddMarkers: (markers: Marker[]) => void;
  onStatus: (message: string) => void;
  /** beat carregado no editor, decodificado */
  getBeatBuffer: () => Promise<AudioBuffer>;
  /** substitui o áudio do editor (ex.: mix final) */
  onUseAudio: (blob: Blob, name: string) => void;
}

interface LineData {
  line: LyricLine;
  buffer: AudioBuffer;
  words: WordTiming[];
  markers: Marker[];
}

interface VoiceInfo {
  voice_id: string;
  name: string;
}

const TOKEN_STORAGE_KEY = "rapbeasts.adminToken";

export default function PremiumPanel({
  bpm,
  onAddMarkers,
  onStatus,
  getBeatBuffer,
  onUseAudio,
}: PremiumPanelProps) {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null);
  const [theme, setTheme] = useState("");
  const [language, setLanguage] = useState<"pt" | "en">("pt");
  const [turns, setTurns] = useState(2);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [lyricsTitle, setLyricsTitle] = useState("");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [cloneType, setCloneType] = useState<"ivc" | "pvc">("ivc");
  const [cloneLanguage, setCloneLanguage] = useState("pt");
  const [beatPrompt, setBeatPrompt] = useState("");
  const [beatStyle, setBeatStyle] = useState("hip hop");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const audioStash = useRef<Array<{ name: string; blob: Blob }>>([]);
  const lineData = useRef<LineData[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage só existe após a hidratação
    setToken(saved);
    setTokenInput(saved);
  }, []);

  // Conta Google + entitlement (assinatura Stripe)
  useEffect(() => {
    const unsubscribeAuth = watchAuth((nextUser) => {
      setUser(nextUser);
      setEntitlement(null);
    });
    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!user) return;
    return watchEntitlement(user.uid, setEntitlement);
  }, [user]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const bearer = token || (await getFirebaseIdToken());
      if (!bearer) {
        throw new Error(
          "entre com Google (seção de nuvem) ou defina o token dev",
        );
      }
      const response = await fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${bearer}`,
        },
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | T;
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String(data.error)
            : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return data as T;
    },
    [token],
  );

  const onCheckout = async () => {
    setBusy(true);
    try {
      const result = await api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await getFirebaseIdToken() }),
      });
      window.location.href = result.url;
    } catch (error) {
      onStatus(
        `Falha ao abrir o checkout: ${error instanceof Error ? error.message : String(error)}`,
      );
      setBusy(false);
    }
  };

  const onPortal = async () => {
    setBusy(true);
    try {
      const result = await api<{ url: string }>("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await getFirebaseIdToken() }),
      });
      window.location.href = result.url;
    } catch (error) {
      onStatus(
        `Falha ao abrir o portal: ${error instanceof Error ? error.message : String(error)}`,
      );
      setBusy(false);
    }
  };

  const saveToken = () => {
    const value = tokenInput.trim();
    setToken(value);
    window.localStorage.setItem(TOKEN_STORAGE_KEY, value);
    onStatus("Token premium salvo.");
  };

  const onGenerateLyrics = async () => {
    if (!theme.trim()) {
      onStatus("Escreva o tema da batalha.");
      return;
    }
    setBusy(true);
    setProgress("Gerando letra…");
    try {
      const result = await api<{
        language: string;
        title: string;
        lines: LyricLine[];
      }>("/api/lyrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, language, turns }),
      });
      setLines(result.lines);
      setLyricsTitle(result.title);
      setProgress(
        `${result.lines.length} linhas geradas (${result.language}) — escolha a voz e clique em "Gerar voz e alinhar".`,
      );
      onStatus(`Letra gerada: ${result.title}`);
    } catch (error) {
      setProgress("");
      onStatus(
        `Falha ao gerar letra: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const loadVoices = async () => {
    try {
      const result = await api<{ voices: VoiceInfo[] }>("/api/voices");
      setVoices(result.voices);
      setVoiceId((previous) =>
        previous && result.voices.some((v) => v.voice_id === previous)
          ? previous
          : (result.voices[0]?.voice_id ?? ""),
      );
      onStatus(`${result.voices.length} vozes carregadas.`);
    } catch (error) {
      onStatus(
        `Falha ao listar vozes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const onGenerateVoices = async () => {
    if (lines.length === 0) {
      onStatus("Gere a letra primeiro.");
      return;
    }
    if (!voiceId) {
      onStatus("Escolha uma voz (ou clone a sua).");
      return;
    }
    setBusy(true);
    const newMarkers: Marker[] = [];
    const newLineData: LineData[] = [];
    const decodeContext = new AudioContext();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setProgress(`Gerando voz da linha ${i + 1}/${lines.length}…`);
      try {
        const result = await api<{
          audio_base64: string;
          alignment: CharacterAlignment | null;
        }>("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: line.text.replaceAll("/", " "), voice_id: voiceId }),
        });
        let buffer: AudioBuffer | null = null;
        if (result.audio_base64) {
          const blob = await fetch(
            `data:audio/mpeg;base64,${result.audio_base64}`,
          ).then((r) => r.blob());
          audioStash.current.push({ name: `line_${i + 1}.mp3`, blob });
          buffer = await decodeContext.decodeAudioData(
            await blob.arrayBuffer(),
          );
        }
        const words = wordsFromAlignment(result.alignment);
        const lineMarkers = alignWordsToGrid(words, bpm, line.side);
        newMarkers.push(...lineMarkers);
        if (buffer) {
          newLineData.push({ line, buffer, words, markers: lineMarkers });
        }
      } catch (error) {
        await decodeContext.close();
        setProgress("");
        onStatus(
          `Falha na linha ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
        setBusy(false);
        return;
      }
    }
    await decodeContext.close();
    lineData.current = newLineData;
    onAddMarkers(newMarkers);
    setProgress(
      `${newMarkers.length} notas alinhadas · ${audioStash.current.length} áudios de voz prontos para mixar.`,
    );
    onStatus(`${newMarkers.length} notas geradas e alinhadas no chart.`);
    setBusy(false);
  };

  const onMix = async () => {
    if (lineData.current.length === 0) {
      onStatus("Gere a voz primeiro (botão acima).");
      return;
    }
    setBusy(true);
    setProgress("Mixando beat + voz…");
    try {
      const beat = await getBeatBuffer();
      const slices: WordSlice[] = [];
      for (const data of lineData.current) {
        for (let i = 0; i < data.words.length; i++) {
          const word = data.words[i];
          const marker = data.markers[i];
          if (!marker) continue;
          slices.push({
            buffer: data.buffer,
            startSec: word.startMs / 1000,
            endSec: word.endMs / 1000,
            atMs: marker.t,
          });
        }
      }
      const mixed = await mixToBuffer(beat, slices);
      const blob = audioBufferToWavBlob(mixed);
      const name = "full_pt.wav";
      downloadBlob(blob, name);
      onUseAudio(blob, name);
      setProgress(
        `Mix pronto: ${name} (${slices.length} palavras encaixadas no grid) — áudio do editor atualizado; use o tipo "full_song" na exportação.`,
      );
      onStatus("Mix concluído: beat + voz em full_pt.wav.");
    } catch (error) {
      setProgress("");
      onStatus(
        `Falha na mixagem: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const onClone = async () => {
    if (!cloneName.trim() || cloneFiles.length === 0) {
      onStatus("Nome e ao menos 1 amostra de áudio para clonar.");
      return;
    }
    setBusy(true);
    setProgress("Clonando voz…");
    try {
      const form = new FormData();
      form.append("name", cloneName);
      form.append("type", cloneType);
      if (cloneType === "pvc") form.append("language", cloneLanguage);
      for (const file of cloneFiles) form.append("files", file);
      const result = await api<{
        voice_id: string;
        requires_verification: boolean;
        type: string;
      }>("/api/clone", { method: "POST", body: form });
      const verificationNote =
        cloneType === "pvc" || result.requires_verification
          ? " — PVC exige verificação de consentimento: conclua no dashboard da ElevenLabs antes de usar."
          : "";
      setProgress(`Voz clonada: ${result.voice_id} (${result.type})${verificationNote}`);
      onStatus(`Voz clonada: ${result.voice_id}${verificationNote}`);
      await loadVoices();
    } catch (error) {
      setProgress("");
      onStatus(
        `Falha ao clonar: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const onGenerateBeat = async () => {
    setBusy(true);
    setProgress("Gerando beat por IA (pode levar ~1min)…");
    try {
      const result = await api<{ audio_base64: string; mime: string }>(
        "/api/beat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: beatPrompt, style: beatStyle }),
        },
      );
      const blob = await fetch(
        `data:${result.mime || "audio/mpeg"};base64,${result.audio_base64}`,
      ).then((r) => r.blob());
      const name = `beat_ia_${Date.now()}.mp3`;
      downloadBlob(blob, name);
      onUseAudio(blob, name);
      setProgress(`Beat de IA pronto: ${name} — áudio do editor atualizado.`);
      onStatus("Beat de IA gerado e carregado no editor.");
    } catch (error) {
      setProgress("");
      onStatus(
        `Falha ao gerar beat: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Premium (Fase 2)</h2>
      <div className="row">
        {!user ? (
          <span className="legend">
            Entre com Google (seção de nuvem) para usar o premium.
          </span>
        ) : entitlement?.premium ? (
          <>
            <span className="legend">
              ✅ Premium ativo ({entitlement.status}
              {entitlement.validUntil
                ? ` até ${new Date(entitlement.validUntil * 1000).toLocaleDateString("pt-BR")}`
                : ""}
              ) — {user.email}
            </span>
            <button disabled={busy} onClick={() => void onPortal()}>
              Gerenciar assinatura
            </button>
          </>
        ) : (
          <>
            <span className="legend">
              Premium inativo — {user.email}
            </span>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void onCheckout()}
            >
              Assinar premium (Stripe)
            </button>
          </>
        )}
      </div>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Token dev (opcional — ADMIN_TOKEN do servidor)
          <input
            type="password"
            value={tokenInput}
            placeholder="só para desenvolvimento; em branco usa a conta Google"
            onChange={(e) => setTokenInput(e.target.value)}
          />
        </label>
        <button onClick={saveToken}>Salvar token</button>
      </div>

      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Tema da batalha
          <input
            type="text"
            value={theme}
            placeholder="ex.: beco do mercado, galo de briga"
            onChange={(e) => setTheme(e.target.value)}
          />
        </label>
        <label className="field">
          Idioma
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "pt" | "en")}
          >
            <option value="pt">PT</option>
            <option value="en">EN</option>
          </select>
        </label>
        <label className="field">
          Turnos por lado
          <select
            value={turns}
            onChange={(e) => setTurns(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => void onGenerateLyrics()}>
          Gerar letra
        </button>
      </div>

      {lines.length > 0 && (
        <div>
          <p className="legend">
            <strong>{lyricsTitle}</strong> — {lines.length} linhas:
          </p>
          <ul className="cloud-list">
            {lines.map((line, index) => (
              <li key={`${line.text}-${index}`}>
                <span>
                  [{line.side === "player" ? "você" : "rival"}] {line.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Voz (ElevenLabs)
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            <option value="">— escolha —</option>
            {voices.map((voice) => (
              <option key={voice.voice_id} value={voice.voice_id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => void loadVoices()}>
          Atualizar vozes
        </button>
        <button className="primary" disabled={busy || !token} onClick={() => void onGenerateVoices()}>
          Gerar voz e alinhar
        </button>
        <button className="primary" disabled={busy} onClick={() => void onMix()}>
          Mixar beat + voz (full_pt.wav)
        </button>
      </div>

      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Clonar minha voz
          <input
            type="text"
            value={cloneName}
            placeholder="nome da voz (ex.: Eu - MC)"
            onChange={(e) => setCloneName(e.target.value)}
          />
        </label>
        <label className="field">
          Tipo
          <select
            value={cloneType}
            onChange={(e) => setCloneType(e.target.value as "ivc" | "pvc")}
          >
            <option value="ivc">IVC (rápido)</option>
            <option value="pvc">PVC (profissional)</option>
          </select>
        </label>
        {cloneType === "pvc" && (
          <label className="field">
            Idioma das amostras
            <select
              value={cloneLanguage}
              onChange={(e) => setCloneLanguage(e.target.value)}
            >
              <option value="pt">pt</option>
              <option value="en">en</option>
            </select>
          </label>
        )}
        <label className="field">
          Amostras (1–3 áudios)
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={(e) =>
              setCloneFiles(Array.from(e.target.files ?? []).slice(0, 3))
            }
          />
        </label>
        <button disabled={busy} onClick={() => void onClone()}>
          Clonar voz
        </button>
      </div>

      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Beat por IA (Suno — estilo)
          <input
            type="text"
            value={beatPrompt}
            placeholder="descrição opcional (ex.: beco à noite, baixo pesado)"
            onChange={(e) => setBeatPrompt(e.target.value)}
          />
        </label>
        <label className="field">
          Estilo
          <select value={beatStyle} onChange={(e) => setBeatStyle(e.target.value)}>
            <option value="hip hop">hip hop</option>
            <option value="boom bap">boom bap</option>
            <option value="trap">trap</option>
            <option value="lo-fi">lo-fi</option>
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => void onGenerateBeat()}>
          Gerar beat (IA)
        </button>
      </div>

      {progress && <p className="status">{progress}</p>}
    </section>
  );
}
