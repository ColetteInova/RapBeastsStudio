#!/usr/bin/env python3
"""Constrói o dataset de fine-tune (JSONL) a partir do corpus de letras.

Uso: python scripts/build_dataset.py <corpus.txt> <diretório-saída>
Gera {train,valid,test}.jsonl no formato {"text": ...} do mlx_lm
(TextDataset — compatível com modelos sem chat template, ex.: GPT-2).
"""

import html
import json
import random
import re
import sys
import unicodedata
from pathlib import Path

random.seed(42)

MAX_EXAMPLES = 3000
TRAIN_RATIO = 0.9

STRIP_ACCENTS_RE = re.compile(r"[\u0300-\u036f]")
WORD_SPLIT_RE = re.compile(r"[^a-záâãàçéêíóôõúü'-]+", re.IGNORECASE)
VOWEL_RUNS_RE = re.compile(r"[aeiouáâãàéêíóôõúü]+", re.IGNORECASE)
SINGLE_WEAK_VOWEL_RE = re.compile(r"[aeoâãàáéêèóôõò]", re.IGNORECASE)


def strip_accents(s: str) -> str:
    return STRIP_ACCENTS_RE.sub("", unicodedata.normalize("NFD", s))


def tokenize(line: str) -> list[str]:
    return [
        w
        for w in WORD_SPLIT_RE.split(line.lower())
        if w and not re.fullmatch(r"[-']+", w)
    ]


def rhyme_key(word: str) -> str:
    """Espelha rhymeKeyOf() de src/lib/rhyme_model.ts."""
    tokens = tokenize(word)
    w = tokens[-1] if tokens else word.lower()
    runs = VOWEL_RUNS_RE.findall(w)
    if not runs:
        return strip_accents(w) or "?"
    last_run = runs[-1]
    idx = w.rfind(last_run)
    key = w[idx:]
    if key == last_run and SINGLE_WEAK_VOWEL_RE.fullmatch(last_run):
        prev = w[idx - 1] if idx > 0 else ""
        if prev and not re.match(r"[aeiouáâãàéêíóôõúü]", prev):
            key = prev + key
    return strip_accents(key)


def clean_line(line: str) -> str:
    line = html.unescape(line)
    line = re.sub(r"\[[^\]]*\]", " ", line)
    line = re.sub(r"<[^>]+>", " ", line)
    line = re.sub(r"[♪♫]", " ", line)
    return re.sub(r"\s+", " ", line).strip()


def load_corpus(path: Path) -> list[str]:
    lines: list[str] = []
    previous = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = clean_line(raw)
        if not line or line == previous:
            continue
        if len(tokenize(line)) < 2:
            continue
        previous = line
        lines.append(line)
    return lines


def build_examples(lines: list[str]) -> list[dict[str, str]]:
    by_key: dict[str, list[str]] = {}
    for line in lines:
        by_key.setdefault(rhyme_key(line.split()[-1]), []).append(line)

    examples: list[dict[str, str]] = []
    seen: set[str] = set()

    # A) Quadra completa com instrução de rima.
    for i in range(0, max(1, len(lines) - 3)):
        stanza = lines[i : i + 4]
        text = "\n".join(stanza)
        if text in seen:
            continue
        seen.add(text)
        key = rhyme_key(stanza[-1].split()[-1])
        examples.append(
            {
                "text": (
                    'Gere uma quadra de rap em português, no estilo RapBeasts, '
                    f'rimando em "{key}":\n'
                    + text
                    + "\n\n"
                )
            }
        )
        examples.append(
            {
                "text": (
                    "Complete a rima:\n"
                    + "\n".join(stanza[:3])
                    + "\n"
                    + stanza[3]
                    + "\n"
                )
            }
        )

    # B) Listas de palavras que rimam (ensina o dicionário de rimas).
    for key, group in by_key.items():
        last_words = [line.split()[-1] for line in group]
        unique = list(dict.fromkeys(last_words))[:6]
        if len(unique) < 3:
            continue
        examples.append(
            {
                "text": f'Liste palavras que rimam em "{key}":\n' + "\n".join(unique) + "\n\n"
            }
        )

    # Embaralha e limita.
    random.shuffle(examples)
    if len(examples) > MAX_EXAMPLES:
        examples = examples[:MAX_EXAMPLES]
    return examples


def main() -> None:
    if len(sys.argv) != 3:
        print("Uso: build_dataset.py <corpus.txt> <diretório-saída>", file=sys.stderr)
        sys.exit(2)
    corpus_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    lines = load_corpus(corpus_path)
    if len(lines) < 10:
        print("Corpus curto demais (< 10 linhas).", file=sys.stderr)
        sys.exit(1)

    examples = build_examples(lines)
    split = int(len(examples) * TRAIN_RATIO)
    train, rest = examples[:split], examples[split:]
    valid, test = rest[: max(1, len(rest) // 2)], rest[max(1, len(rest) // 2) :]

    for name, data in (("train", train), ("valid", valid), ("test", test)):
        with (out_dir / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for ex in data:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    print(f"corpus={len(lines)} linhas | exemplos={len(examples)} "
          f"(train={len(train)}, valid={len(valid)}, test={len(test)})")


if __name__ == "__main__":
    main()
