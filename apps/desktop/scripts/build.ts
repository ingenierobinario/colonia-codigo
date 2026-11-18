// Bundles main (ESM) and the panel preload (CJS: sandboxed preloads cannot be ESM) into dist/.
import fs from "node:fs";
import path from "node:path";
import { type BuildOptions, build } from "esbuild";
import { BLOBS } from "../../../packages/ui/src/blobs/catalog.ts";
import { buildVersion } from "../../../scripts/version.ts";
import { cursorFace } from "./cursor-face.ts";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });

const common: BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
  define: {
    COLONIA_VERSION: JSON.stringify(
      buildVersion(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, root),
    ),
  },
};
await build({
  ...common,
  entryPoints: [path.join(root, "src/main/main.ts")],
  outfile: path.join(out, "main.js"),
  format: "esm",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/panel/preload.ts")],
  outfile: path.join(out, "panel-preload.cjs"),
  format: "cjs",
});
await build({
  ...common,
  entryPoints: [path.join(root, "src/main/contrasenas/app-preload.ts")],
  outfile: path.join(out, "app-preload.cjs"),
  format: "cjs",
});
// The menu-bar icon (a macOS template image: black on transparent, tinted by the system).
for (const f of fs.readdirSync(path.join(root, "assets"))) {
  if (/\.(png|svg)$/.test(f) || /^tray-.*\.ico$/.test(f))
    fs.copyFileSync(path.join(root, "assets", f), path.join(out, f));
}
for (const file of ["cursor.html", "cursor-overlay.js"]) {
  fs.copyFileSync(path.join(root, "assets", file), path.join(out, file));
}
// El puntero usa el mismo cuerpo y los mismos ojos que la ficha del agente, sin cargar imágenes de la red.
const faces = path.join(out, "cursor-faces");
fs.mkdirSync(faces, { recursive: true });
for (const [name, preset] of Object.entries(BLOBS)) {
  fs.writeFileSync(path.join(faces, name + ".svg"), cursorFace(preset));
}
console.log("built apps/desktop/dist");
