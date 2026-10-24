# RapBeasts Studio

Editor web de letras e ritmos do **RapBeasts** (jogo Godot 4.7, repo separado).
Cria charts no formato v3 do jogo e os sincroniza como **Song Packages** que o
jogo toca via `CustomSongManager` (pasta `user://custom_songs/` na Fase 0,
nuvem na Fase 1+).

## Status (Fase 0 + Fase 1)

**Fase 0 (ferramenta pessoal)** — concluída:

- [x] Player de áudio (wavesurfer) + waveform + playhead
- [x] Tap com quantização (grid de semicolcheias pelo BPM) + offset de calibração
- [x] Metrônomo com acento no 1 (lookahead scheduling)
- [x] Preview das lanes caindo (distribuição de colunas igual ao jogo, 3/4/5 lanes)
- [x] Notas por palavra, lado (player/rival), round (1/2/3), tipos tap/trigger/hold
- [x] Derivação de dificuldades (easy = 1 nota a cada 2 palavras)
- [x] Validação client-side espelhando o `ChartValidator` do jogo
- [x] Export de `manifest.json` (Song Package v1)
- [x] Testes de paridade de validação (22 fixtures, jogo × Studio)

**Fase 1 (nuvem — Firebase)** — ✅ configurada (projeto `rapbeasts-studio`, rules implantadas):

- [x] Login Google + estado de auth (sem config → modo local)
- [x] Empacotar zip (manifest + áudio) e enviar para Firebase Storage + índice no Firestore
- [x] Listar/remover músicas da nuvem
- [x] Rules de segurança (leitura pública, escrita autenticada) em `firebase/`

**Fase 2 (premium)** — 🚧 em andamento:

- [x] Rotas server-side `/api/lyrics`, `/api/voices`, `/api/tts`, `/api/clone` com gate `ADMIN_TOKEN` (chaves de IA nunca vão ao cliente)
- [x] Letras por LLM OpenAI-compatible (prompt das regras de rimas do jogo)
- [x] TTS com timestamps → auto-alinhamento palavra→nota no grid
- [x] Clone de voz IVC + painel Premium no editor
- [x] Sequenciador de bateria sintetizada (3 presets, swing, preview) + WAV via OfflineAudioContext
- [x] Mixagem beat + voz com palavras encaixadas no grid → `full_pt.wav`
- [x] Export com tipo de package (chart_only / full_song)
- [x] Stripe/entitlements: checkout + portal + webhook → `entitlements/{uid}`; gate das rotas de IA por idToken + entitlement (402) + créditos diários
**Fase 3 (UGC público)** — ✅ implementada:

- [x] Publicar/despublicar com moderação por LLM + share codes (6 dígitos)
- [x] Vitrine comunitária no Studio e no jogo + busca por código
- [x] Placares: jogo posta via sessão anônima; Studio mostra top 10
- [x] Denúncias → `reports/`; remoção vira soft delete (status `removed`)
- [ ] Habilitar provedor Anonymous no Firebase console (placares) · auto-takedown por denúncias

## Comandos

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # verificação de produção
npm run parity         # runner de paridade local (imprime vereditos)
npm run parity:fixtures # regenera fixtures/chart_parity/
npx tsx scripts/align_test.ts   # teste do auto-alinhamento premium
scripts/compare_parity.sh ../RapBeasts   # diff jogo × Studio (GODOT_BIN=... se preciso)
firebase deploy --only firestore:rules,storage  # regras de segurança
```

### Debug no VS Code

`.vscode/launch.json` traz as configurações prontas (F5 ou painel **Run and Debug**):

- **Next.js: debug server-side** — sobe `next dev --inspect` (breakpoints em Server
  Components, rotas de API e `src/lib`).
- **Next.js: debug client-side (Chrome)** — abre `http://localhost:3000` no Chrome
  com os breakpoints do cliente (o dev server precisa já estar rodando).
- **Next.js: debug full stack** — sobe servidor + Chrome juntos e encerra o servidor
  ao parar a sessão.
- **Next.js: attach server-side (port 9229)** — anexa a um dev server já iniciado
  com `npm run dev -- --inspect`.

## Estrutura

```
src/
├── app/            # rotas (Next.js App Router)
├── components/     # componentes de UI (client)
└── lib/            # modelo/validação do chart (espelho do ChartValidator)
contracts/          # contrato Song Package v1 (espelho das docs do jogo)
```

## Contratos e paridade

`contracts/song-package-v1.md` documenta o formato. As regras de validação em
`src/lib/chart.ts` são um **espelho** de `scripts/core/chart_validator.gd` do
jogo — as docs do jogo (`docs/chart-format.md`, `docs/studio-app.md`) são a
fonte de verdade; qualquer mudança lá deve ser refletida aqui (e vice-versa).

## Roadmap

Ver `docs/studio-app.md` no repo do jogo (fases 0–3).
