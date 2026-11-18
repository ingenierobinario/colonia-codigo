import fs from "node:fs";
import type { BlobPreset } from "../../../packages/ui/src/blobs/catalog.ts";

export function cursorFace(preset: BlobPreset): string {
  const body = fs.readFileSync(new URL(preset.src)).toString("base64");
  const eyes = preset.eyes
    .map(
      ({ x, y, w, h, rx }) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${preset.eyeColor}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/webp;base64,${body}"/>${eyes}</svg>`;
}
