"use client";

import { useCallback, useEffect, useState } from "react";

type ModelStats = {
  lines: number;
  words: number;
  pairs: number;
  rhymeGroups: number;
};

type SmartJob = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  step: number | null;
  iters: number;
  loss: number | null;
  elapsedSec: number;
  createdAt: string;
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

  // --- Modelo inteligente (LLM/MLX) ---
  const [smartJobs, setSmartJobs] = useState<SmartJob[]>([]);
  const [smartBusy, setSmartBusy] = useState(false);
  const [llmIters, setLlmIters] = useState(2000);
  const [llmRhyme, setLlmRhyme] = useState("");
  const [llmSeed, setLlmSeed] = useState("");
  const [llmCount, setLlmCount] = useState(4);
  const [llmGenBusy, setLlmGenBusy] = useState(false);
  const [llmGenerated, setLlmGenerated] = useState<string[]>([]);

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

  // Polling dos jobs de fine-tune (só localhost, custo baixo).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/admin/api/train/smart");
        const data = await parseJson<{ jobs: SmartJob[] }>(res);
        if (!cancelled) setSmartJobs(data.jobs ?? []);
      } catch {
        /* servidor fora do ar etc. */
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const smartDoneJob = smartJobs.find((j) => j.status === "done") ?? null;
  const smartRunning = smartJobs.some((j) => j.status === "running");

  async function onTrainLlm() {
    if (!transcript.trim()) {
      setError("Extraia as letras ou cole um texto antes do fine-tune.");
      return;
    }
    setSmartBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/admin/api/train/smart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: modelName || "LLM de rimas",
          text: transcript,
          iters: llmIters,
        }),
      });
      const data = await parseJson<{ job: SmartJob }>(res);
      setStatus(
        `Fine-tune iniciado em background (${data.job.iters} iterações). ` +
          "Acompanhe o progresso abaixo.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao iniciar treino.");
    } finally {
      setSmartBusy(false);
    }
  }

  async function onGenerateLlm() {
    if (!smartDoneJob) {
      setError("Treine o modelo inteligente antes de gerar.");
      return;
    }
    setLlmGenBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/admin/api/train/smart/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId: smartDoneJob.id,
          rhyme: llmRhyme || undefined,
          seed: llmSeed || undefined,
          count: llmCount,
        }),
      });
      const data = await parseJson<{ lines: string[] }>(res);
      setLlmGenerated(data.lines);
      setStatus(`${data.lines.length} linha(s) gerada(s) pelo LLM.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na geração LLM.");
    } finally {
      setLlmGenBusy(false);
    }
  }

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

      <section className="card">
        <h2>5 · Modelo Inteligente (LLM local)</h2>
        <p className="tagline" style={{ margin: "4px 0 12px" }}>
          Fine-tune de um LLM em português (GPT-2 médio treinado em PT-BR,
          355M) com MLX + LoRA no seu Mac — usa o texto da seção 2 como
          corpus. Roda 100% local.
        </p>
        <div className="row">
          <label className="field">
            Iterações
            <input
              type="number"
              min={20}
              max={4000}
              step={20}
              value={llmIters}
              onChange={(e) => setLlmIters(Number(e.target.value) || 2000)}
            />
          </label>
          <button
            className="primary"
            disabled={smartBusy || smartRunning || !transcript.trim()}
            onClick={onTrainLlm}
            type="button"
          >
            {smartRunning
              ? "Treinando…"
              : smartBusy
                ? "Iniciando…"
                : "Treinar LLM"}
          </button>
        </div>

        {smartJobs.length === 0 ? (
          <p className="status">Nenhum fine-tune feito ainda.</p>
        ) : (
          <ul className="cloud-list">
            {smartJobs.map((j) => (
              <li key={j.id}>
                <span>
                  {j.name || "LLM"}{" "}
                  <span className="status">
                    {j.status === "running"
                      ? ` · treinando ${j.step ?? 0}/${j.iters} iters${
                          j.loss != null ? ` · loss ${j.loss.toFixed(2)}` : ""
                        } · ${Math.round(j.elapsedSec / 60)}min`
                      : j.status === "done"
                        ? " · pronto"
                        : " · falhou"}{" "}
                    · {new Date(j.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          <label className="field">
            Semente (opcional)
            <input
              type="text"
              placeholder="ex.: na quebrada"
              value={llmSeed}
              onChange={(e) => setLlmSeed(e.target.value)}
            />
          </label>
          <label className="field">
            Palavra para rimar (opcional)
            <input
              type="text"
              placeholder="ex.: coração"
              value={llmRhyme}
              onChange={(e) => setLlmRhyme(e.target.value)}
            />
          </label>
          <label className="field">
            Linhas
            <input
              type="number"
              min={1}
              max={8}
              value={llmCount}
              onChange={(e) => setLlmCount(Number(e.target.value) || 4)}
            />
          </label>
          <button
            className="primary"
            disabled={llmGenBusy || !smartDoneJob}
            onClick={onGenerateLlm}
            type="button"
          >
            {llmGenBusy ? "Gerando…" : "Gerar com LLM"}
          </button>
        </div>
        {llmGenerated.length > 0 ? (
          <ol className="score-list">
            {llmGenerated.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        ) : null}
      </section>
    </main>
  );
}
