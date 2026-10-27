#!/usr/bin/env python3
"""Converte um GPT-2 do Hugging Face (.bin) para o formato MLX.

O mlx-lm não lê .bin nem o prefixo "transformer." dos pesos do HF:
instala torch no venv, salva safetensors via transformers, renomeia
transformer.* -> model.* e transpõe os pesos Conv1D.

Uso: python scripts/convert_hf_gpt2.py <hf-repo> <mlx-path>
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

import huggingface_hub


def main() -> None:
    if len(sys.argv) != 3:
        print("Uso: convert_hf_gpt2.py <hf-repo> <mlx-path>", file=sys.stderr)
        sys.exit(2)

    repo = sys.argv[1]
    mlx_path = Path(sys.argv[2])
    tmp = Path(tempfile.mkdtemp(prefix="gpt2conv-"))
    try:
        snap = Path(huggingface_hub.snapshot_download(repo))
        out = tmp / "hf"
        out.mkdir(parents=True, exist_ok=True)

        from transformers import AutoModelForCausalLM

        model = AutoModelForCausalLM.from_pretrained(snap)
        model.save_pretrained(str(out), safe_serialization=True)
        for name in os.listdir(snap):
            src = snap / name
            if src.is_file() and not src.name.endswith(".bin"):
                shutil.copy(src, out / name)

        # Renomeia transformer.* -> model.* e transpõe pesos Conv1D.
        from safetensors import safe_open
        from safetensors.torch import save_file

        weights_file = out / "model.safetensors"
        tensors = {}
        with safe_open(str(weights_file), framework="pt") as f:
            for key in f.keys():
                tensors[key] = f.get_tensor(key)

        fixed = {}
        for key, value in tensors.items():
            if key.startswith("lm_head."):
                continue
            new_key = key.replace("transformer.", "model.", 1)
            if new_key.endswith(
                (
                    "attn.c_attn.weight",
                    "attn.c_proj.weight",
                    "mlp.c_fc.weight",
                    "mlp.c_proj.weight",
                )
            ):
                fixed[new_key] = value.transpose(0, 1).contiguous()
            else:
                fixed[new_key] = value
        save_file(fixed, str(weights_file))

        import subprocess

        subprocess.run(
            [
                sys.executable,
                "-m",
                "mlx_lm",
                "convert",
                "--hf-path",
                str(out),
                "--mlx-path",
                str(mlx_path),
                "--dtype",
                "bfloat16",
            ],
            check=True,
        )
        print(f"OK -> {mlx_path}", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
