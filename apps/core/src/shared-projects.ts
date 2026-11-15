// PROYECTO-COMPARTIR-1 · Dónde vive la copia publicada de un proyecto: `<home>/shared-projects/<enlace>.json`, y un
// índice de qué enlace tiene cada proyecto. La copia es la foto de cuando el dueño pulsó «Publicar», ya sin datos de acceso.
import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "./paths.ts";

const TOKEN = /^[a-f0-9]{32}$/;
const dir = (home: string) => path.join(home, "shared-projects");
const fileOf = (home: string, token: string) => path.join(dir(home), `${token}.json`);

/** Proyecto → enlace, de lo publicado ahora. */
export function sharedIndex(home: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir(home), "index.json"), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && TOKEN.test(v))) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function writeIndex(home: string, index: Record<string, string>): void {
  fs.mkdirSync(dir(home), { recursive: true });
  writeAtomic(path.join(dir(home), "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

/** El enlace de un proyecto publicado, o nada. */
export function sharedToken(home: string, project: string): string | undefined {
  const token = sharedIndex(home)[project];
  return token && fs.existsSync(fileOf(home, token)) ? token : undefined;
}

/** Guarda (o renueva) la copia publicada de un proyecto bajo su enlace. */
export function putShared(home: string, project: string, token: string, content: string): void {
  if (!TOKEN.test(token)) throw new Error("bad link");
  fs.mkdirSync(dir(home), { recursive: true });
  writeAtomic(fileOf(home, token), content);
  writeIndex(home, { ...sharedIndex(home), [project]: token });
}

/** Deja de publicar un proyecto: su enlace deja de responder. */
export function dropShared(home: string, project: string): void {
  const { [project]: token, ...rest } = sharedIndex(home);
  if (!token) return;
  fs.rmSync(fileOf(home, token), { force: true });
  writeIndex(home, rest);
}

/** Lo que responde un enlace: la copia publicada, o nada si ya no lo está. */
export function readShared(home: string, token: string): string | undefined {
  if (!TOKEN.test(token) || !Object.values(sharedIndex(home)).includes(token)) return undefined;
  try {
    return fs.readFileSync(fileOf(home, token), "utf8");
  } catch {
    return undefined;
  }
}
