// COPIA-COMPLETA-1 · Qué vive en la carpeta de Colonia y qué viaja en la copia completa (DECISIONS.md#d-192). La regla es
// una lista de EXCLUSIÓN: lo que no esté aquí viaja, así una carpeta nueva del núcleo entra sola en la copia en vez
// de quedarse fuera sin que nadie lo note.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Canales cuya sesión está atada al equipo o al teléfono que la abrió: no se clonan, se vuelven a vincular. */
export const SESSION_BOUND = new Set(["whatsapp", "imessage", "signal"]);

/** Lo que nunca viaja, con el motivo. Nombres de primer nivel dentro de la carpeta de Colonia. */
const LOCAL_ONLY: Readonly<Record<string, string>> = {
  "core.env": "cómo se accede a ESTE equipo (puerto, dirección, llave de acceso)",
  "home-id": "la identidad de esta instalación; cada equipo tiene la suya",
  "telemetry-id": "identificador anónimo de esta instalación",
  logs: "registros de este equipo",
  browser: "perfil del navegador sin ventana de este equipo (sesiones atadas al equipo)",
  models: "modelos locales descargados; se vuelven a descargar",
  "codex-images": "imágenes temporales",
  computer: "el ordenador virtual de este equipo",
  bin: "programas instalados para este sistema",
  "update-coordination.json": "estado de la actualización en curso",
  "equipo.json": "la ficha de este equipo en «Mis equipos»",
  "equipo.clave.cifrada": "la llave de este equipo en «Mis equipos»",
  "sincronizar.json": "con qué otro equipo se sincroniza ESTE (D-192 fase 2)",
  copias: "las copias guardadas aquí",
  ".restaurar": "una restauración a medias",
};

/** Secretos que no viajan: son de este equipo, no de la persona. */
const LOCAL_SECRETS = new Set(["equipo.clave"]);

const LOCAL_PREFIX = ["colonia.db", "daemon-lock.sqlite", "secrets.", ".restaurar"];
/** Rutas relativas que se regeneran solas. */
const DERIVED = new Set(["media/posters", "media/open"]);

export const travelsTop = (name: string) => !(name in LOCAL_ONLY) && !LOCAL_PREFIX.some((p) => name.startsWith(p));
export const secretTravels = (name: string) => !LOCAL_SECRETS.has(name) && !name.startsWith("sync.");

export type FileEntry = { rel: string; abs: string; size: number };

/** Los ficheros de `dir`, relativos con «/», sin seguir enlaces simbólicos. */
export function walkFiles(
  dir: string,
  rel: string,
  skip: (rel: string) => boolean,
  out: FileEntry[] = [],
): FileEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink() || skip(r)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(abs, r, skip, out);
    else if (e.isFile()) {
      try {
        out.push({ rel: r, abs, size: fs.statSync(abs).size });
      } catch {}
    }
  }
  return out;
}

/** Los ficheros de la carpeta de Colonia que viajan. `bound` son los ids de canal cuya sesión se queda aquí. */
export function homeFiles(home: string, bound: ReadonlySet<string>): FileEntry[] {
  return walkFiles(home, "", (rel) => {
    const parts = rel.split("/");
    if (parts.length === 1) return !travelsTop(rel);
    if (DERIVED.has(parts.slice(0, 2).join("/"))) return true;
    return parts[0] === "channels" && parts.length === 2 && bound.has(parts[1] as string);
  });
}

export type Summary = {
  projects: number;
  chats: number;
  messages: number;
  flows: number;
  agents: number;
  channels: number;
  memories: number;
  browsers: number;
  apps: number;
  providers: number;
  people: number;
  routines: number;
};

export type ChannelRef = { id: string; type: string; name: string };
export type ExternalProject = { id: string; name: string; path: string };

export type DbFacts = {
  summary: Summary;
  schema_version: number;
  channels: ChannelRef[];
  /** Proyectos cuya carpeta está fuera de la de Colonia. */
  external: ExternalProject[];
};

const listSetting = (db: DatabaseSync, key: string): Record<string, unknown>[] => {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(`setting:${key}`) as { value: string } | undefined;
  if (!row) return [];
  try {
    const v = JSON.parse(row.value) as unknown;
    return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : [];
  } catch {
    return [];
  }
};

const insideDir = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Qué hay en una base de Colonia, contado por categoría. Abre el fichero aparte y solo lee. */
export function factsOf(dbFile: string, home: string): DbFacts {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    const count = (table: string, where = "") =>
      tables.has(table)
        ? Number((db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get() as { n: number }).n)
        : 0;
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    const channels = listSetting(db, "channels").map((c) => ({
      id: String(c.id ?? ""),
      type: String(c.type ?? ""),
      name: String(c.label ?? c.type ?? ""),
    }));
    const external = tables.has("projects")
      ? (
          db
            .prepare("SELECT id, name, path FROM projects WHERE path IS NOT NULL AND path <> ''")
            .all() as ExternalProject[]
        ).filter((p) => path.isAbsolute(p.path) && !insideDir(home, p.path))
      : [];
    return {
      summary: {
        projects: count("projects"),
        chats: count("threads"),
        messages: count("messages"),
        flows: count("flows"),
        agents: count("agents"),
        channels: channels.length,
        memories: count("memories"),
        browsers: listSetting(db, "navegadores").length,
        apps: listSetting(db, "webapps").length,
        providers: listSetting(db, "providers").filter((p) => p.removed !== true).length,
        people: count("persons"),
        routines: count("routines"),
      },
      schema_version: version ? Number(version.value) : 0,
      channels,
      external,
    };
  } finally {
    db.close();
  }
}

/** Lo que viaja de un proyecto cuya carpeta está fuera: sus instrucciones y su configuración, no los archivos de trabajo. */
export function externalFiles(root: string): FileEntry[] {
  const out: FileEntry[] = [];
  const agents = path.join(root, "AGENTS.md");
  try {
    const st = fs.lstatSync(agents);
    if (st.isFile()) out.push({ rel: "AGENTS.md", abs: agents, size: st.size });
  } catch {}
  try {
    if (fs.lstatSync(path.join(root, ".apc")).isDirectory())
      walkFiles(path.join(root, ".apc"), ".apc", () => false, out);
  } catch {}
  return out;
}

export type Manifest = {
  format: "colonia-copia-1";
  created_at: string;
  app_version: string;
  schema_version: number;
  from: { home: string; homedir: string; platform: string; host: string; home_id: string };
  summary: Summary;
  secrets: number;
  files: number;
  bytes: number;
  channels: ChannelRef[];
  external: ExternalProject[];
};
