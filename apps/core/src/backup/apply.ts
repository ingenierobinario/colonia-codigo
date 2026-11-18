// COPIA-COMPLETA-1 · Cumple una restauración pendiente al arrancar, antes de que nadie abra la base
// (DECISIONS.md#d-192). «Reemplazar» deja este equipo como el de la copia; «fusionar» añade lo que falta y, donde las
// dos partes tienen lo mismo, gana lo que ya había aquí. Las rutas guardadas se pasan a las de este equipo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../db/db.ts";
import { travelsTop } from "./inventory.ts";
import { type Pending, readPending, STAGE_DIR, writePending } from "./restore.ts";

/** Lo que la tarjeta de Ajustes enseña tras restaurar, guardado en la propia base. */
export const RESULT_KEY = "setting:copia_restaurada";

export type RestoreResult = {
  at: string;
  mode: Pending["mode"];
  host: string;
  relink: Pending["relink"];
  browsers: number;
  safety?: string;
  secrets_failed?: string[];
  summary: Pending["summary"];
};

type Move = { fromHome: string; toHome: string; fromUser: string; toUser: string; fromWin: boolean; toWin: boolean };

const startsWithPath = (value: string, prefix: string, win: boolean) => {
  if (!prefix || value.length < prefix.length) return false;
  const head = value.slice(0, prefix.length);
  if (win ? head.toLowerCase() !== prefix.toLowerCase() : head !== prefix) return false;
  const next = value[prefix.length];
  return next === undefined || next === "/" || next === "\\";
};

/** Una ruta del equipo de origen, en este: la carpeta de Colonia y la del usuario cambian de sitio. */
export function movePath(value: string, m: Move): string {
  const swap = (prefix: string, to: string) => {
    const rest = value.slice(prefix.length);
    return to + (m.fromWin === m.toWin ? rest : m.toWin ? rest.replaceAll("/", "\\") : rest.replaceAll("\\", "/"));
  };
  if (startsWithPath(value, m.fromHome, m.fromWin)) return swap(m.fromHome, m.toHome);
  if (m.fromUser !== m.toUser && startsWithPath(value, m.fromUser, m.fromWin)) return swap(m.fromUser, m.toUser);
  return value;
}

const deep = (v: unknown, f: (s: string) => string): unknown =>
  typeof v === "string"
    ? f(v)
    : Array.isArray(v)
      ? v.map((x) => deep(x, f))
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)]))
        : v;

/** Columnas que guardan una ruta tal cual, y las que guardan JSON con rutas dentro. */
const PATH_COLUMNS: readonly (readonly [string, string])[] = [
  ["projects", "path"],
  ["threads", "cwd"],
  ["jobs", "cwd"],
  ["media", "path"],
  ["extensions", "dir"],
];
const JSON_COLUMNS: readonly (readonly [string, string])[] = [
  ["projects", "read_only_folders"],
  ["pending_inputs", "folders"],
  ["meta", "value"],
];

const columnsOf = (db: DatabaseSync, schema: string, table: string) =>
  (db.prepare("SELECT name, type, pk FROM pragma_table_info(?, ?)").all(table, schema) as {
    name: string;
    type: string;
    pk: number;
  }[]) ?? [];

/** Pasa las rutas de la base preparada a las de este equipo. */
export function rewritePaths(db: DatabaseSync, m: Move): void {
  if (m.fromHome === m.toHome && m.fromUser === m.toUser) return;
  const has = (table: string, column: string) => columnsOf(db, "main", table).some((c) => c.name === column);
  const each = (table: string, column: string, f: (s: string) => string) => {
    if (!has(table, column)) return;
    const rows = db.prepare(`SELECT rowid AS r, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL`).all() as {
      r: number;
      v: unknown;
    }[];
    const put = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of rows) {
      if (typeof row.v !== "string") continue;
      const next = f(row.v);
      if (next !== row.v) put.run(next, row.r);
    }
  };
  const move = (s: string) => movePath(s, m);
  for (const [t, c] of PATH_COLUMNS) each(t, c, move);
  for (const [t, c] of JSON_COLUMNS)
    each(t, c, (s) => {
      if (!/^[[{"]/.test(s)) return move(s);
      try {
        return JSON.stringify(deep(JSON.parse(s), move));
      } catch {
        return s;
      }
    });
}

/** Tablas que la fusión no copia: se rellenan solas (índices de búsqueda) o son del momento. */
const DERIVED_TABLES = new Set(["messages_n", "message_media", "idempotency", "sqlite_sequence"]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Un ajuste presente en las dos partes: en las listas con `id` se añaden los que faltan; en lo demás gana lo local. */
function mergeSetting(local: string, incoming: string): string {
  try {
    const a = JSON.parse(local) as unknown;
    const b = JSON.parse(incoming) as unknown;
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => isObject(x) && typeof x.id === "string")) {
      const ids = new Set((a as Json[]).map((x) => x.id));
      return JSON.stringify([...a, ...(b as Json[]).filter((x) => !ids.has(x.id))]);
    }
    if (isObject(a) && isObject(b)) return JSON.stringify({ ...b, ...a });
  } catch {}
  return local;
}

/** Añade a la base local lo que trae la preparada. Devuelve cuántas filas entraron. */
export function mergeDb(local: DatabaseSync, stagedFile: string): number {
  let added = 0;
  local.exec("PRAGMA foreign_keys = OFF");
  local.prepare("ATTACH DATABASE ? AS copia").run(stagedFile);
  try {
    local.exec("BEGIN IMMEDIATE");
    try {
      const names = (schema: string) =>
        (
          local.prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = 'table'`).all() as {
            name: string;
            sql: string | null;
          }[]
        ).filter((t) => !t.name.startsWith("sqlite_"));
      const mine = names("main");
      const virtual = mine.filter((t) => /^CREATE VIRTUAL/i.test(t.sql ?? "")).map((t) => t.name);
      const theirs = new Set(names("copia").map((t) => t.name));
      for (const { name } of mine) {
        if (name === "meta" || DERIVED_TABLES.has(name) || !theirs.has(name)) continue;
        if (virtual.some((v) => name === v || name.startsWith(`${v}_`))) continue;
        const cols = columnsOf(local, "main", name);
        const other = new Set(columnsOf(local, "copia", name).map((c) => c.name));
        const pk = cols.filter((c) => c.pk > 0);
        // Un número de fila propio de cada equipo no identifica nada: se deja que esta base ponga el suyo.
        const counter = pk.length === 1 && /^INTEGER$/i.test(pk[0]?.type ?? "") ? pk[0]?.name : undefined;
        const common = cols.filter((c) => other.has(c.name) && c.name !== counter).map((c) => `"${c.name}"`);
        if (!common.length) continue;
        const list = common.join(", ");
        const sql = counter
          ? `INSERT OR IGNORE INTO main."${name}" (${list}) SELECT ${list} FROM copia."${name}" EXCEPT SELECT ${list} FROM main."${name}"`
          : `INSERT OR IGNORE INTO main."${name}" (${list}) SELECT ${list} FROM copia."${name}"`;
        added += Number(local.prepare(sql).run().changes);
      }
      const rows = local
        .prepare(
          "SELECT c.key AS key, c.value AS incoming, m.value AS local FROM copia.meta c LEFT JOIN main.meta m ON m.key = c.key WHERE c.key <> 'schema_version'",
        )
        .all() as { key: string; incoming: string; local: string | null }[];
      const put = local.prepare(
        "INSERT INTO main.meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const row of rows) {
        const next = row.local === null ? row.incoming : mergeSetting(row.local, row.incoming);
        if (next !== row.local) put.run(row.key, next);
      }
      local.exec("COMMIT");
    } catch (err) {
      local.exec("ROLLBACK");
      throw err;
    }
  } finally {
    local.exec("DETACH DATABASE copia");
    local.exec("PRAGMA foreign_keys = ON");
  }
  return added;
}

const moveFile = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
};

/** Pasa el árbol `from` a `to`. Con `keep`, lo que ya existe en el destino se queda como está. */
function moveTree(from: string, to: string, keep: boolean): void {
  const existing = fs.lstatSync(to, { throwIfNoEntry: false });
  if (keep && existing && !existing.isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) moveTree(a, b, keep);
    else if (e.isFile() && !(keep && fs.lstatSync(b, { throwIfNoEntry: false }))) moveFile(a, b);
  }
}

const moveOf = (home: string, from: Pending["from"]): Move => ({
  fromHome: from.home,
  toHome: path.resolve(home),
  fromUser: from.homedir,
  toUser: os.homedir(),
  fromWin: from.platform === "win32",
  toWin: process.platform === "win32",
});

/** Dónde queda en este equipo un proyecto cuya carpeta estaba fuera de la de Colonia. */
export function externalTarget(home: string, p: { name: string; path: string }, m: Move): string {
  const moved = movePath(p.path, m);
  // En Windows «/work/x» también es absoluta (cuelga de la unidad actual), pero es de Linux o macOS: solo vale
  // una ruta con letra de unidad o de red (TRASLADO-EXTERNO-1).
  const native = m.toWin ? /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(moved) : path.posix.isAbsolute(moved);
  if (native && fs.existsSync(path.parse(moved).root)) return moved;
  // Una ruta de otro sistema o de un disco que aquí no existe: el proyecto se queda dentro de Colonia.
  const safe = p.name.replace(/[^\p{L}\p{N} ._-]+/gu, "-").slice(0, 60) || "proyecto";
  return path.join(home, "projects", `trasladado-${safe}`);
}

/** Cumple la restauración pendiente, si la hay. Se llama antes de abrir la base. */
export function applyPendingRestore(home: string, warn: (msg: string) => void = () => {}): RestoreResult | undefined {
  const dir = path.join(home, STAGE_DIR);
  const pending = readPending(home);
  if (!pending) {
    // Una preparación que no llegó a dejar su orden no vale: se retira.
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  try {
    const m = moveOf(home, pending.from);
    const stagedDb = path.join(dir, "db", "colonia.db");
    const dbFile = path.join(home, "colonia.db");
    const targets = pending.external.map((p) => ({ ...p, target: externalTarget(home, p, m) }));

    if (!pending.rewritten && fs.existsSync(stagedDb)) {
      const staged = new DatabaseSync(stagedDb);
      try {
        rewritePaths(staged, m);
        const put = staged.prepare("UPDATE projects SET path = ? WHERE id = ?");
        for (const t of targets) put.run(t.target, t.id);
        // Lo que era de aquel equipo y no de la persona no entra en este.
        staged.exec("DELETE FROM meta WHERE key IN ('setting:secrets_file_told', 'setting:copia_restaurada')");
      } finally {
        staged.close();
      }
      // Una sola vez: repetirlo tras un corte movería dos veces una ruta ya movida.
      pending.rewritten = true;
      writePending(home, pending);
    }

    if (pending.mode === "replace") {
      if (!pending.cleared) {
        const keep = new Set(pending.keep_channels);
        for (const name of fs.readdirSync(home)) {
          if (name.startsWith("colonia.db")) {
            fs.rmSync(path.join(home, name), { force: true });
            continue;
          }
          if (!travelsTop(name)) continue;
          if (name !== "channels" || keep.size === 0) {
            fs.rmSync(path.join(home, name), { recursive: true, force: true });
            continue;
          }
          for (const id of fs.readdirSync(path.join(home, name)))
            if (!keep.has(id)) fs.rmSync(path.join(home, name, id), { recursive: true, force: true });
        }
        pending.cleared = true;
        writePending(home, pending);
      }
      if (fs.existsSync(stagedDb)) moveFile(stagedDb, dbFile);
      moveTree(path.join(dir, "home"), home, false);
    } else {
      if (!pending.merged && fs.existsSync(stagedDb)) {
        // La copia puede venir de una versión anterior: se pone al día antes de mezclarla.
        const stagedHome = path.join(dir, "db");
        openDb(stagedHome).close();
        const local = openDb(home);
        try {
          mergeDb(local, stagedDb);
        } finally {
          local.close();
        }
        pending.merged = true;
        writePending(home, pending);
      }
      moveTree(path.join(dir, "home"), home, true);
    }
    // Las instrucciones y la configuración de los proyectos de fuera: nunca pisan lo que ya haya en la carpeta.
    for (const t of targets) moveTree(path.join(dir, "external", t.id), t.target, true);

    const result: RestoreResult = {
      at: pending.at,
      mode: pending.mode,
      host: pending.from.host,
      relink: pending.relink,
      browsers: pending.browsers,
      summary: pending.summary,
      ...(pending.safety ? { safety: pending.safety } : {}),
      ...(pending.secrets_failed?.length ? { secrets_failed: pending.secrets_failed } : {}),
    };
    const db = openDb(home);
    try {
      db.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(RESULT_KEY, JSON.stringify(result));
    } finally {
      db.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
  } catch (err) {
    // Una restauración que falla no puede dejar a Colonia sin arrancar: se aparta y se cuenta.
    warn(`la restauración de la copia no se pudo completar: ${err instanceof Error ? err.message : String(err)}`);
    try {
      fs.renameSync(dir, path.join(home, `.restaurar-fallida-${Date.now()}`));
    } catch {
      fs.rmSync(path.join(dir, "pendiente.json"), { force: true });
    }
    return undefined;
  }
}
