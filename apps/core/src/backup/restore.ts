// COPIA-COMPLETA-1 · Restaurar una copia completa en este equipo (DECISIONS.md#d-192), en dos tiempos. Con Colonia en
// marcha se descifra la copia a `.restaurar/` (los secretos van directos al almacén del sistema: nunca tocan el disco
// en claro) y se deja una orden pendiente; al volver a arrancar, apply.ts la cumple antes de abrir la base.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackupSummary, ProjectBackupScope } from "@colonia/protocol";
import { MIGRATIONS } from "../db/migrations.ts";
import type { Secrets } from "../secrets.ts";
import { ArchiveError, type EntrySink, readArchive } from "./archive.ts";
import { type ChannelRef, type Manifest, PRIVATE_PROJECT_FORMAT, SESSION_BOUND, secretTravels } from "./inventory.ts";

import { STAGE_DIR } from "./stage.ts";

export { STAGE_DIR };
export const PENDING = "pendiente.json";

export type RestoreMode = "replace" | "merge";

export type Pending = {
  mode: RestoreMode;
  at: string;
  from: Manifest["from"];
  /** Canales de sesión única cuya sesión local se conserva al reemplazar. */
  keep_channels: string[];
  /** Lo que la persona tendrá que volver a vincular. */
  relink: ChannelRef[];
  browsers: number;
  external: Manifest["external"];
  summary: Manifest["summary"];
  /** La copia de lo que había, hecha antes de tocar nada. */
  safety?: string;
  /** Claves que el almacén de este equipo no aceptó: hay que volver a ponerlas a mano. */
  secrets_failed?: string[];
  rewritten?: boolean;
  cleared?: boolean;
  merged?: boolean;
};

const safeRel = (rel: string) =>
  rel.length > 0 &&
  !rel.includes("\\") &&
  !rel.includes("\0") &&
  !path.posix.isAbsolute(rel) &&
  !/^[A-Za-z]:/.test(rel) &&
  rel.split("/").every((s) => s !== "" && s !== "." && s !== "..");

const parseManifest = (bytes: Buffer): Manifest => {
  let m: Manifest;
  try {
    m = JSON.parse(bytes.toString("utf8")) as Manifest;
  } catch {
    throw new ArchiveError("broken");
  }
  if (!m?.from || !m.summary) throw new ArchiveError("broken");
  if (m.format === PRIVATE_PROJECT_FORMAT) {
    if (
      !ProjectBackupScope.safeParse(m.scope).success ||
      !BackupSummary.safeParse(m.summary).success ||
      m.summary.projects !== 1 ||
      m.secrets !== 0 ||
      !Array.isArray(m.channels) ||
      m.channels.length ||
      !Array.isArray(m.external) ||
      m.external.length ||
      !Number.isSafeInteger(m.files) ||
      m.files < 0 ||
      !Number.isSafeInteger(m.bytes) ||
      m.bytes < 0
    )
      throw new ArchiveError("broken");
  } else if (m.format !== "colonia-copia-1" || m.scope !== undefined) throw new ArchiveError("broken");
  if (m.schema_version > MIGRATIONS.length) throw new ArchiveError("newer");
  return m;
};

const memory = (max: number, done: (bytes: Buffer) => void): EntrySink => {
  const parts: Buffer[] = [];
  let size = 0;
  return {
    write(b) {
      size += b.length;
      if (size > max) throw new ArchiveError("broken");
      parts.push(Buffer.from(b));
    },
    end: () => done(Buffer.concat(parts)),
  };
};

/** Lo que trae una copia, sin restaurar nada: solo se descifra su primera entrada. */
export async function inspectCopy(file: string, password: string): Promise<Manifest> {
  let manifest: Manifest | undefined;
  await readArchive(file, password, (meta) => {
    if (manifest || meta.p !== "manifest.json") return "stop";
    return memory(4 * 1024 * 1024, (bytes) => {
      manifest = parseManifest(bytes);
    });
  });
  if (!manifest) throw new ArchiveError("broken");
  return manifest;
}

/** Los canales de la copia que habrá que volver a vincular aquí, y las sesiones locales que se conservan. */
export function relinkOf(home: string, manifest: Manifest): { relink: ChannelRef[]; keep: string[] } {
  const relink: ChannelRef[] = [];
  const keep: string[] = [];
  for (const c of manifest.channels) {
    if (!SESSION_BOUND.has(c.type) || !/^[A-Za-z0-9_-]{1,80}$/.test(c.id)) continue;
    if (fs.existsSync(path.join(home, "channels", c.id))) keep.push(c.id);
    else relink.push(c);
  }
  return { relink, keep };
}

export type StageDeps = { home: string; secrets: Secrets; now?: () => Date };

/**
 * Descifra la copia a `.restaurar/` y deja la orden pendiente. Devuelve la orden; quien llama reinicia Colonia.
 * `safety` es la copia de lo que había, ya escrita.
 */
export async function stageRestore(
  deps: StageDeps,
  file: string,
  password: string,
  mode: RestoreMode,
  safety: string | undefined,
  progress: (done: number, total: number) => void = () => {},
): Promise<Pending> {
  const dir = path.join(deps.home, STAGE_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let manifest: Manifest | undefined;
  let secrets: Record<string, string> = {};
  let done = 0;
  let open: number | undefined;
  try {
    await readArchive(file, password, (meta) => {
      if (meta.p === "manifest.json")
        return memory(4 * 1024 * 1024, (bytes) => {
          if (manifest) throw new ArchiveError("broken");
          manifest = parseManifest(bytes);
          if (manifest.format !== "colonia-copia-1") throw new ArchiveError("scope");
        });
      if (!manifest) throw new ArchiveError("broken");
      if (meta.p === "secrets.json")
        return memory(16 * 1024 * 1024, (bytes) => {
          try {
            secrets = JSON.parse(bytes.toString("utf8")) as Record<string, string>;
          } catch {
            throw new ArchiveError("broken");
          }
        });
      const rel = meta.p === "colonia.db" ? "db/colonia.db" : meta.p;
      if (!safeRel(rel) || !/^(db|home|external)\//.test(rel)) throw new ArchiveError("broken");
      const target = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const fd = fs.openSync(target, "w", 0o600);
      open = fd;
      const total = manifest.bytes;
      return {
        write(b) {
          fs.writeSync(fd, b);
          done += b.length;
          progress(done, total);
        },
        end() {
          fs.closeSync(fd);
          open = undefined;
        },
      };
    });
    if (!manifest || !fs.existsSync(path.join(dir, "db", "colonia.db"))) throw new ArchiveError("broken");
    const m: Manifest = manifest;
    const { relink, keep } = relinkOf(deps.home, m);
    // Los secretos, al almacén de este equipo. Al fusionar, lo que ya hay aquí gana.
    // RESTAURAR-DPAPI-1: todos de una vez (en Windows, un solo PowerShell en vez de uno por clave), y una clave que el
    // almacén no acepta no tumba la restauración: queda anotada para volver a ponerla a mano.
    const incoming: Record<string, string> = {};
    for (const [name, value] of Object.entries(secrets)) {
      if (typeof value !== "string" || !secretTravels(name)) continue;
      if (mode === "merge" && deps.secrets.listed(name)) continue;
      incoming[name] = value;
    }
    const { failed } = deps.secrets.setMany(incoming);
    const pending: Pending = {
      mode,
      at: (deps.now ?? (() => new Date()))().toISOString(),
      from: m.from,
      keep_channels: keep,
      relink,
      browsers: m.summary.browsers + m.summary.apps,
      external: m.external,
      summary: m.summary,
      ...(safety ? { safety } : {}),
      ...(failed.length ? { secrets_failed: failed } : {}),
    };
    writePending(deps.home, pending);
    return pending;
  } catch (err) {
    // En Windows una carpeta con un fichero abierto no se puede borrar.
    if (open !== undefined)
      try {
        fs.closeSync(open);
      } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function writePending(home: string, pending: Pending): void {
  const file = path.join(home, STAGE_DIR, PENDING);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(pending, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

export function readPending(home: string): Pending | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, STAGE_DIR, PENDING), "utf8")) as Pending;
  } catch {
    return undefined;
  }
}

/** Carpetas donde la persona suele dejar una copia, para ofrecerlas sin que escriba una ruta. */
export function usualFolders(home: string): string[] {
  const user = os.homedir();
  const all = [
    path.join(user, "Downloads"),
    path.join(user, "Descargas"),
    path.join(user, "Desktop"),
    path.join(user, "Escritorio"),
    path.join(user, "Documents"),
    path.join(user, "Documentos"),
    path.join(home, "copias"),
  ];
  return all.filter((d, i) => all.indexOf(d) === i && fs.existsSync(d));
}
