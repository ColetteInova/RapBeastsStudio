import JSZip from "jszip";
import type { PackageManifest } from "@/lib/chart";

/**
 * Empacota o Song Package v1 em zip (contrato da Fase 1 — o jogo baixa o zip
 * e extrai em user://custom_songs/<song_id>/).
 */
export async function buildPackageZip(
  manifest: PackageManifest,
  audioFile: Blob | null,
  audioName: string,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  if (audioFile) {
    zip.file(audioName.trim() || "beat.ogg", audioFile);
  }
  return zip.generateAsync({ type: "blob" });
}
