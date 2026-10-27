#!/usr/bin/env python3
"""Gera rimas com o LLM fine-tunado (MLX + LoRA).

Uso: python scripts/generate_mlx.py --adapter <adapters.safetensors>
     --rhyme <palavra|chave> [--seed-text ...] [--count 4]
Saída: JSON {"lines": [...]}
"""

import argparse
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

DEFAULT_MODEL = str(
    Path(__file__).resolve().parent.parent
    / "data"
    / "rhyme-llm"
    / "_base"
    / "gpt2-pt-medium"
)

STRIP_ACCENTS_RE = re.compile(r"[\u0300-\u036f]")
WORD_SPLIT_RE = re.compile(r"[^a-záâãàçéêíóôõúü'-]+", re.IGNORECASE)
VOWEL_RUNS_RE = re.compile(r"[aeiouáâãàéêíóôõúü]+", re.IGNORECASE)
SINGLE_WEAK_VOWEL_RE = re.compile(r"[aeoâãàáéêèóôõò]", re.IGNORECASE)


def strip_accents(s: str) -> str:
    return STRIP_ACCENTS_RE.sub("", unicodedata.normalize("NFD", s))


def rhyme_key(word: str) -> str:
    tokens = [w for w in WORD_SPLIT_RE.split(word.lower()) if w]
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


def parse_lines(text: str, prompt: str) -> list[str]:
    body = text[len(prompt) :] if text.startswith(prompt) else text
    out: list[str] = []
    seen: set[str] = set()
    for raw in body.splitlines():
        line = html.unescape(raw)
        line = re.sub(r"\s+", " ", line).strip().strip('"“”')
        line = re.sub(r"^[>»≫《》]+", "", line).strip()
        line = re.sub(r"^[-–—]\s+", "", line)
        if not line:
            continue
        # Filtra alucinações de URL/markdown do modelo.
        if re.search(r"https?://|!\[|\]\(", line):
            continue
        if len(re.findall(r"[a-záâãàçéêíóôõúü]{2}", line, re.IGNORECASE)) < 2:
            continue
        if len(line.split()) < 2:
            continue
        if re.fullmatch(r"[-–—_*·•]+", line):
            continue
        low = line.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(line)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--rhyme", default="")
    parser.add_argument("--seed-text", default="")
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--temp", type=float, default=0.7)
    args = parser.parse_args()

    adapter = Path(args.adapter).resolve()
    if not adapter.exists():
        print(json.dumps({"error": "Adapter não encontrado."}), flush=True)
        sys.exit(1)
    adapter_dir = adapter.parent  # mlx_lm.load espera o diretório

    # Import pesado só depois de validar os argumentos.
    from mlx_lm import generate, load
    from mlx_lm.sample_utils import make_sampler

    target_key = rhyme_key(args.rhyme) if args.rhyme else ""
    if args.rhyme and not target_key:
        print(json.dumps({"error": "Rima inválida."}), flush=True)
        sys.exit(1)

    if args.seed_text:
        prompt = (
            "Complete a rima:\n" f"{args.seed_text}\n"
        )
    else:
        # Mesmo formato dos exemplos de treino: a chave de rima, não a palavra.
        prompt = (
            "Gere uma quadra de rap em português, no estilo RapBeasts, "
            f'rimando em "{target_key or "rimas fortes"}":\n'
        )

    model, tokenizer = load(args.model, adapter_path=adapter_dir)
    sampler = make_sampler(temp=args.temp, top_p=0.9)
    raw = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=args.max_tokens,
        sampler=sampler,
    )

    lines = parse_lines(raw, prompt)
    if target_key:
        keep = []
        for line in lines:
            words = line.split()
            if words and rhyme_key(words[-1]) == target_key:
                keep.append(line)
        if keep:
            # prefere manter a ordem de geração
            lines = [l for l in lines if l in keep][: args.count]
        else:
            # Fallback: sem linha com a rima exata, devolve as linhas geradas
            # mesmo assim (o modelo pequeno nem sempre obedece).
            lines = lines[: args.count]
    else:
        lines = lines[: args.count]

    print(json.dumps({"lines": lines}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
