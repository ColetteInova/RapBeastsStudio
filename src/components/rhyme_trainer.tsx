"use client";

import { useCallback, useEffect, useState } from "react";

type ModelStats = {
  lines: number;
  words: number;
  pairs: number;
  rhymeGroups: number;
};

type ModelMeta = {
  id: string;
  name: string;
  sourceUrl: string | null;
  createdAt: string;
  order: number;
  stats: ModelStats;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Erro inesperado.");
  return data;
}

export default function RhymeTrainer() {
  const [url, setUrl] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [modelName, setModelName] = useState("");
  const [trainBusy, setTrainBusy] = useState(false);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [seed, setSeed] = useState("");
  const [rhyme, setRhyme] = useState("");
  const [count, setCount] = useState(4);
  const [genBusy, setGenBusy] = useState(false);
  const [generated, setGenerated] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const listModels = useCallback(async () => {
    const res = await fetch("/admin/api/train");
    const data = await parseJson<{ models: ModelMeta[] }>(res);
    setModels(data.models ?? []);
    setSelectedModelId((prev) => prev || data.models?.[0]?.id || "");
  }, []);

  useEffect(() => {
    listModels().catch(() => {
      /* listagem opcional */
    });
  }, [listModels]);

  async function onExtract() {
    setExtractBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/admin/api/train/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await parseJson<{
        title: string;
        text: string;
        lineCount: number;
      }>(res);
      setTitle(data.title);
      setTranscript(data.text);
      setModelName((prev) => prev || data.title);
      setStatus(`Letras extraídas: ${data.lineCount} linhas utilizáveis.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na extração.");
    } finally {
      setExtractBusy(false);
    }
  }

  async function onTrain() {
    if (!transcript.trim()) {
      setError("Extraia as letras ou cole um texto antes de treinar.");
      return;
    }
    setTrainBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/admin/api/train", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: modelName,
          text: transcript,
          sourceUrl: url || null,
        }),
      });
      const data = await parseJson<{ model: ModelMeta }>(res);
      setSelectedModelId(data.model.id);
      setStatus(
        `Modelo treinado: ${data.model.stats.lines} linhas, ` +
          `${data.model.stats.words} palavras, ` +
          `${data.model.stats.rhymeGroups} grupos de rima.`,
      );
      await listModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no treino.");
    } finally {
      setTrainBusy(false);
    }
  }

  async function onGenerate() {
    if (!selectedModelId) {
      setError("Selecione um modelo treinado.");
      return;
    }
    setGenBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/admin/api/train/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModelId,
          seed: seed || undefined,
          rhyme: rhyme || undefined,
          count,
        }),
      });
      const data = await parseJson<{ lines: string[] }>(res);
      setGenerated(data.lines);
      setStatus(`${data.lines.length} linha(s) gerada(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na geração.");
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <main>
      <h1>
        Treino de <span className="accent">rimas</span>
      </h1>
      <p className="tagline">
        Extraia letras de um vídeo do YouTube (localhost) e treine um modelo
        estatístico de rimas.
      </p>

      <section className="card">
        <h2>1 · Extrair letras do YouTube</h2>
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 260 }}>
            Link do vídeo
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={extractBusy || !url.trim()}
            onClick={onExtract}
            type="button"
          >
            {extractBusy ? "Extraindo…" : "Extrair letras"}
          </button>
        </div>
        <p className="status">
          Use apenas conteúdo que você tem direito de usar (vídeos próprios ou
          com licença livre). A extração roda só na sua máquina.
        </p>
      </section>

      <section className="card">
        <h2>2 · Letras (extraídas ou coladas)</h2>
        <textarea
          rows={12}
          placeholder="Cole as letras aqui ou use a extração acima…"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            Nome do modelo
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={trainBusy || !transcript.trim()}
            onClick={onTrain}
            type="button"
          >
            {trainBusy ? "Treinando…" : "Treinar modelo"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>3 · Modelos treinados</h2>
        {models.length === 0 ? (
          <p className="status">Nenhum modelo treinado ainda.</p>
        ) : (
          <ul className="cloud-list">
            {models.map((m) => (
              <li key={m.id}>
                <span>
                  {m.name || "Sem nome"}{" "}
                  <span className="status">
                    · {m.stats.lines} linhas · {m.stats.rhymeGroups} rimas ·{" "}
                    {new Date(m.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </span>
                <button
                  disabled={m.id === selectedModelId}
                  onClick={() => setSelectedModelId(m.id)}
                  type="button"
                >
                  {m.id === selectedModelId ? "Selecionado" : "Usar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>4 · Gerar rimas</h2>
        <div className="row">
          <label className="field">
            Semente (opcional)
            <input
              type="text"
              placeholder="ex.: na quebrada"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <label className="field">
            Palavra para rimar (opcional)
            <input
              type="text"
              placeholder="ex.: coração"
              value={rhyme}
              onChange={(e) => setRhyme(e.target.value)}
            />
          </label>
          <label className="field">
            Linhas
            <input
              type="number"
              min={1}
              max={16}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 4)}
            />
          </label>
          <button
            className="primary"
            disabled={genBusy || !selectedModelId}
            onClick={onGenerate}
            type="button"
          >
            {genBusy ? "Gerando…" : "Gerar"}
          </button>
        </div>
        {error ? <p className="errors">{error}</p> : null}
        {status ? <p className="status">{status}</p> : null}
        {generated.length > 0 ? (
          <ol className="score-list">
            {generated.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        ) : null}
      </section>
    </main>
  );
}
