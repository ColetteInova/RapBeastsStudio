# AGENTS.md — RapBeasts Studio

Guia de convenções para agentes que trabalham neste repositório (web app do
RapBeasts). O **jogo** vive em outro repo (`RapBeasts`); este repo contém o
editor web e o contrato de sincronização.

## Visão geral

- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript, npm.
- **Áudio**: `wavesurfer.js` + Web Audio API.
- **Produto**: editor de charts que gera Song Packages (JSON v3 do jogo).

## Comandos

- `npm run dev` — servidor local (http://localhost:3000).
- `npm run build` — build de produção (roda ESLint; erro = falha).
- `npm run lint` — ESLint.

## Convenções

- TypeScript estrito; sem `any` sem justificativa.
- Componentes de UI em `src/components/`; lógica de domínio (chart, validação)
  em `src/lib/` — **nunca** misturar regras de validação em componentes.
- O contrato de dados vive em `contracts/` e em `src/lib/chart.ts`.

## Paridade com o jogo (crítico)

- `src/lib/chart.ts` espelha `ChartValidator`/`ChartParser` do jogo
  (`scripts/core/chart_validator.gd`).
- As docs do jogo (`docs/chart-format.md`, `docs/studio-app.md`) são a fonte
  de verdade do formato. Mudança em um lado ⇒ espelhar no outro e adicionar
  fixture nos testes de paridade.

## Não fazer

- Não commitar segredos (chaves de API, `.env.local` já está no `.gitignore`).
- Não adicionar chamadas de API de IA (ElevenLabs, LLM, Suno) sem gate de
  entitlement server-side — fase 2 do plano (`docs/studio-app.md` no jogo).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
