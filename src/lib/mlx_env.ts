import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

// Resolve o Python do venv MLX. O venv fica FORA do repo porque o Turbopack
// não consegue resolver symlinks internos do projeto.
const CANDIDATES = [
  process.env.MLX_VENV_PYTHON,
  path.join(process.cwd(), ".mlx-venv", "bin", "python"),
  path.join(
    os.homedir(),
    ".venvs",
    "rapbeasts-studio-mlx",
    "bin",
    "python",
  ),
].filter((c): c is string => Boolean(c));

export function venvPython(): string {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return CANDIDATES[CANDIDATES.length - 1]!;
}
