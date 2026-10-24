# Song Package v1 — Contrato de sincronização

> Espelho de `docs/studio-app.md` (§4) do repo do jogo. **As docs do jogo são
> a fonte de verdade** — atualize os dois lados juntos.

Um **Song Package** é a unidade de conteúdo criado no RapBeasts Studio e tocado
pelo jogo. Na Fase 0 ele é uma pasta local; na Fase 1+ vira um zip na nuvem.

```
user://custom_songs/<song_id>/        (Fase 0; zip na nuvem a partir da Fase 1)
├── manifest.json                     (obrigatório — chart v3 + campos de package)
└── <arquivos de áudio>               (full_song; ou referência no chart_only)
```

## `manifest.json`

```json
{
  "package_version": 1,
  "format_version": 3,
  "type": "chart_only",
  "song_id": "u_8f3a1c",
  "title": "Batalha do Meu Beco",
  "author": { "display_name": "..." },
  "lane_count": 5,
  "locale": "pt",
  "beat_ref": "arcade_01",
  "audio": "beat.ogg",
  "bpm_map": [ { "time_ms": 0, "bpm": 96 } ],
  "host_lines": [],
  "host_name": "DJ JABAY",
  "audio_files": { "pt": "full_pt.ogg", "en": "full_en.ogg" },
  "difficulties": { "easy": { "notes": [] }, "normal": { "notes": [] }, "hard": { "notes": [] } }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `package_version` | int | sim | Versão do contrato de package (atual: `1`) |
| `format_version` | int | sim | Versão do chart embutido (atual: `3`) |
| `type` | string | sim | `chart_only` (grátis, sem áudio embarcado) ou `full_song` (premium, embarca áudio) |
| `song_id` | string | sim | Id único; conteúdo de usuário usa prefixo `u_` |
| `title` | string | sim | Título exibido |
| `beat_ref` | string | chart_only | Id do instrumental do catálogo do jogo (`res://assets/audio/arcade/<id>.ogg`) |
| `audio` | string | não | **Fase 0**: nome de arquivo relativo dentro do package |
| `audio_files` | object | full_song | Idioma → arquivo de áudio dentro do package |
| demais campos | — | — | Exatamente o chart v3 (`docs/chart-format.md`) |

### Resolução de áudio no jogo (ordem)

1. `audio_files[<idioma>]` (fallback `pt`) — arquivo dentro do package;
2. `beat_ref` — instrumental do catálogo do jogo;
3. `audio` — nome de arquivo relativo dentro do package (Fase 0).

## Regras de validação (paridade obrigatória)

- **Jogo**: `scripts/core/chart_validator.gd` (`ChartValidator.validate(path, json, require_audio)`)
- **Studio**: `src/lib/chart.ts` (`validatePackage`)

As duas implementações validam as mesmas regras de `docs/chart-format.md` §5:
`format_version` 2–3, `song_id`/`title` não vazios, `lane_count` 3–5, `bpm_map`
crescente começando em 0, `difficulties` não vazio, notas ordenadas com `l`
0–3, `side` player|rival, `type` tap|trigger|hold, trigger com `b` 0–3, hold com
`d > 0` sem sobreposição na mesma lane, host_lines com `t` ou `round`.
