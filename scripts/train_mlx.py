#!/usr/bin/env python3
"""Fine-tune LoRA (MLX) de um LLM pequeno com o corpus de rimas.

Executado pelo admin (localhost). Escreve o progresso em
<job-dir>/state.json para a API consultar.

Uso: python scripts/train_mlx.py --job-dir <dir> [--iters 400] [--name ...]
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_MODEL = str(
    Path(__file__).resolve().parent.parent
    / "data"
    / "rhyme-llm"
    / "_base"
    / "gpt2-pt-medium"
)

ITER_RE = re.compile(r"^\s*(\d+)\s+([\d.]+)\s*[▼▲]?\s+(\d+)")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def write_state(job_dir: Path, state: dict) -> None:
    state["updatedAt"] = datetime.now(timezone.utc).isoformat()
    (job_dir / "state.json").write_text(
        json.dumps(state, ensure_ascii=False), encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", required=True)
    parser.add_argument("--name", default="LLM de rimas")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--iters", type=int, default=2000)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--num-layers", type=int, default=-1)
    parser.add_argument("--max-seq-length", type=int, default=256)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    job_dir = Path(args.job_dir).resolve()
    data_dir = job_dir / "dataset"
    adapter_file = job_dir / "adapters.safetensors"
    log_path = job_dir / "train.log"

    # LoRA com rank maior para mais capacidade de estilo/rima.
    lora_config = job_dir / "lora_config.yaml"
    lora_config.write_text(
        "lora_parameters:\n  rank: 8\n  dropout: 0.0\n  scale: 20.0\n",
        encoding="utf-8",
    )

    started = time.monotonic()
    write_state(
        job_dir,
        {
            "status": "running",
            "step": 0,
            "iters": args.iters,
            "loss": None,
            "elapsedSec": 0,
        },
    )

    cmd = [
        sys.executable,
        "-m",
        "mlx_lm",
        "lora",
        "--model",
        args.model,
        "--train",
        "--data",
        str(data_dir),
        "--fine-tune-type",
        "lora",
        "--num-layers",
        str(args.num_layers),
        "--batch-size",
        str(args.batch_size),
        "--iters",
        str(args.iters),
        "--learning-rate",
        str(args.learning_rate),
        "--max-seq-length",
        str(args.max_seq_length),
        "--steps-per-report",
        "5",
        "--steps-per-eval",
        "50",
        "--save-every",
        "50",
        "--adapter-path",
        str(job_dir),
        "-c",
        str(lora_config),
        "--seed",
        "42",
    ]

    proc = subprocess.Popen(
        cmd,
        cwd=str(project_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    assert proc.stdout is not None
    with log_path.open("w", encoding="utf-8") as log:
        for line in proc.stdout:
            log.write(line)
            log.flush()
            # rich/tqdm colore cada coluna com códigos ANSI.
            clean = ANSI_RE.sub("", line)
            m = ITER_RE.search(clean)
            if m:
                step = int(m.group(1))
                write_state(
                    job_dir,
                    {
                        "status": "running",
                        "step": step,
                        "iters": args.iters,
                        "loss": float(m.group(2)),
                        "elapsedSec": int(time.monotonic() - started),
                    },
                )

    exit_code = proc.wait()
    # Canonicaliza o último checkpoint como adapters.safetensors e remove os
    # intermediários (o mlx-lm salva com prefixo de iteração).
    checkpoints = sorted(
        job_dir.glob("*_adapters.safetensors"),
        key=lambda p: (
            int(p.name.split("_")[0]) if p.name.split("_")[0].isdigit() else 0
        ),
    )
    if checkpoints and exit_code == 0:
        shutil.copyfile(checkpoints[-1], adapter_file)
        for ckpt in checkpoints:
            ckpt.unlink()
    if exit_code == 0 and adapter_file.exists():
        write_state(
            job_dir,
            {
                "status": "done",
                "step": args.iters,
                "iters": args.iters,
                "loss": None,
                "elapsedSec": int(time.monotonic() - started),
            },
        )
        print("TREINO OK", adapter_file, flush=True)
    else:
        write_state(
            job_dir,
            {
                "status": "failed",
                "step": None,
                "iters": args.iters,
                "loss": None,
                "elapsedSec": int(time.monotonic() - started),
            },
        )
        print(f"TREINO FALHOU (exit {exit_code})", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
