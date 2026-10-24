/**
 * Geração de letras de rima via LLM (OpenAI-compatible: OpenAI, Groq,
 * OpenRouter, LM Studio local…). Prompt segue docs/rimas.md do jogo.
 */
import { getEnv } from "@/lib/env";

export interface LyricLine {
  side: "player" | "rival";
  /** texto com "/" separando os compassos da linha */
  text: string;
}

export interface LyricsResult {
  language: string;
  title: string;
  lines: LyricLine[];
}

/** Chamada crua ao LLM (OpenAI-compatible). */
async function complete(
  messages: Array<{ role: string; content: string }>,
  temperature: number,
): Promise<string> {
  const key = getEnv("LLM_API_KEY");
  if (!key) {
    throw new Error("LLM_API_KEY não configurado no servidor");
  }
  const baseUrl = getEnv("LLM_BASE_URL") || "https://api.openai.com/v1";
  const model = getEnv("LLM_MODEL") || "gpt-4o-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`LLM HTTP ${response.status}: ${detail}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

const SYSTEM_PROMPT = `Você escreve rimas de batalha de rap para o jogo RapBeasts (PT-BR).
Regras (docs/rimas.md do jogo):
- Estrutura por turno: 2 a 4 linhas por personagem, alternando "player" e "rival".
- Cada linha dura 1 a 2 compassos (4 a 8 batidas); "/" separa os compassos dentro da linha.
- Esquema de rima AABB (duas linhas seguidas rimando entre si); nunca forçar a rima.
- Sílabas fortes das palavras caem nas batidas 2 e 4 do compasso.
- Tom: gíria de rua, humor pastelão/sátira; zoar o rival, nunca o público.
- Sem palavrões pesados, sem discurso de ódio.
Responda SOMENTE com JSON válido, sem markdown:
{
  "language": "<pt|en>",
  "title": "<título da batalha>",
  "lines": [
    { "side": "player", "text": "Linha de rima, / segunda parte do compasso." },
    { "side": "rival", "text": "Resposta rimada, / com a rima em AABB." }
  ]
}`;

export async function generateLyrics(input: {
  theme: string;
  language: "pt" | "en";
  turns: number;
}): Promise<LyricsResult> {
  const languageText = input.language === "en" ? "inglês" : "português (PT-BR)";
  const userPrompt = `Tema da batalha: ${input.theme}.
Idioma: ${languageText}.
Turnos: ${input.turns} turnos de cada lado (player e rival).`;

  const content = await complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    0.9,
  );
  return parseLyricsJson(content);
}

/** Extrai e valida o JSON da resposta (tolera markdown fences). */
export function parseLyricsJson(content: string): LyricsResult {
  let cleaned = content.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const parsed = JSON.parse(cleaned) as {
    language?: string;
    title?: string;
    lines?: Array<{ side?: string; text?: string }>;
  };
  const lines: LyricLine[] = (parsed.lines ?? [])
    .map((line) => ({
      side: line.side === "rival" ? ("rival" as const) : ("player" as const),
      text: String(line.text ?? "").trim(),
    }))
    .filter((line) => line.text !== "");
  if (lines.length === 0) {
    throw new Error("LLM não retornou linhas válidas");
  }
  return {
    language: parsed.language === "en" ? "en" : "pt",
    title: String(parsed.title ?? "Batalha").trim() || "Batalha",
    lines,
  };
}

const MODERATION_SYSTEM_PROMPT = `Você é o moderador de conteúdo do jogo RapBeasts (batalhas de rap em PT-BR).
Classifique o texto das rimas. Sinalize APENAS violações claras:
- discurso de ódio (raça, gênero, religião…), ameaças graves,
- conteúdo sexual explícito ou envolvendo menores,
- incitação à violência real, dados pessoais, spam/link.
Rimas de batalha com agressividade competitiva NÃO são violação.
Responda SOMENTE com JSON válido, sem markdown:
{ "flagged": true, "reason": "<motivo curto em PT>" }  ou  { "flagged": false, "reason": "" }`;

/** Moderação por LLM (usada antes de publicar e na geração de letras). */
export async function moderateText(
  text: string,
): Promise<{ flagged: boolean; reason: string }> {
  const content = await complete(
    [
      { role: "system", content: MODERATION_SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 4000) },
    ],
    0,
  );
  let cleaned = content.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const parsed = JSON.parse(cleaned) as { flagged?: boolean; reason?: string };
  return {
    flagged: Boolean(parsed.flagged),
    reason: String(parsed.reason ?? "").slice(0, 200),
  };
}
