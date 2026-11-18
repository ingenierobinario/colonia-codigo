// COPIA-COMPLETA-1 · Escribe la copia completa de Colonia en un archivo cifrado (DECISIONS.md#d-192). La base se saca
// con una instantánea coherente (VACUUM INTO) mientras Colonia sigue en marcha; los secretos salen del almacén del
// sistema y solo existen en claro en memoria, camino del cifrado.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../db/db.ts";
import type { Secrets } from "../secrets.ts";
import { writeArchive } from "./archive.ts";
import {
  externalFiles,
  type FileEntry,
  factsOf,
  homeFiles,
  type Manifest,
  SESSION_BOUND,
  secretTravels,
} from "./inventory.ts";

export const COPY_EXT = ".colonia";

export type CreateDeps = {
  home: string;
  db: Db;
  secrets: Secrets;
  version: string;
  homeId: string;
  includeWork?: boolean | undefined;
  now?: () => Date;
};

export type Progress = (phase: "snapshot" | "files", done: number, total: number) => void;

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** Un nombre de archivo libre en `folder`: no pisa una copia anterior. */
export function copyName(folder: string, prefix: string, now: Date): string {
  const base = `${prefix}-${stamp(now)}`;
  for (let i = 0; ; i++) {
    const file = path.join(folder, `${base}${i ? `-${i + 1}` : ""}${COPY_EXT}`);
    if (!fs.existsSync(file)) return file;
  }
}

/** Escribe la copia en `file` y devuelve lo que lleva. Si algo falla, no deja un archivo a medias. */
export async function createCopy(
  deps: CreateDeps,
  file: string,
  password: string,
  progress: Progress = () => {},
): Promise<Manifest> {
  const now = (deps.now ?? (() => new Date()))();
  const work = path.join(deps.home, "copias");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const snapshot = path.join(work, `.instantanea-${process.pid}-${now.getTime()}.db`);
  fs.rmSync(snapshot, { force: true });
  const part = `${file}.parcial`;
  const writer = await writeArchive(part, password, { created_at: now.toISOString(), app_version: deps.version });
  try {
    progress("snapshot", 0, 0);
    deps.db.prepare("VACUUM INTO ?").run(snapshot);
    const facts = factsOf(snapshot, deps.home);
    const bound = new Set(facts.channels.filter((c) => SESSION_BOUND.has(c.type)).map((c) => c.id));
    const files = await homeFiles(deps.home, bound);
    const external: { rel: string; file: FileEntry }[] = [];
    for (const p of facts.external)
      for (const f of await externalFiles(p.path, deps.includeWork))
        external.push({ rel: `external/${p.id}/${f.rel}`, file: f });

    const secrets: Record<string, string> = {};
    for (const { name } of deps.secrets.list()) {
      if (!secretTravels(name)) continue;
      const value = deps.secrets.resolve(`secret://${name}`);
      if (value !== undefined) secrets[name] = value;
    }

    const dbSize = fs.statSync(snapshot).size;
    const bytes = dbSize + files.reduce((n, f) => n + f.size, 0) + external.reduce((n, f) => n + f.file.size, 0);
    const manifest: Manifest = {
      format: "colonia-copia-1",
      created_at: now.toISOString(),
      app_version: deps.version,
      schema_version: facts.schema_version,
      from: {
        home: path.resolve(deps.home),
        homedir: os.homedir(),
        platform: process.platform,
        host: os.hostname(),
        home_id: deps.homeId,
      },
      summary: facts.summary,
      secrets: Object.keys(secrets).length,
      files: files.length + external.length,
      bytes,
      channels: facts.channels,
      external: facts.external,
    };
    await writer.add("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
    await writer.add("secrets.json", Buffer.from(JSON.stringify(secrets), "utf8"));
    let done = 0;
    progress("files", done, bytes);
    await writer.addFile("colonia.db", snapshot);
    done += dbSize;
    progress("files", done, bytes);
    for (const f of files) {
      // Un fichero que desaparece mientras se copia (un temporal) no tumba la copia.
      try {
        await writer.addFile(`home/${f.rel}`, f.abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      done += f.size;
      progress("files", done, bytes);
    }
    for (const f of external) {
      try {
        await writer.addFile(f.rel, f.file.abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      done += f.file.size;
      progress("files", done, bytes);
    }
    await writer.close();
    fs.renameSync(part, file);
    return manifest;
  } catch (err) {
    writer.abort();
    throw err;
  } finally {
    fs.rmSync(snapshot, { force: true });
  }
}
