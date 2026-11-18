import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { realpath } from "../paths.ts";

export const FOLDER_LIMIT = 256;
type Grant = { project: string; root: string | null; choice: number; remote: number };
type ProjectPath = { path: string };
/** La clave incluye el directorio físico: sustituir o reasignar una carpeta exige otra autorización humana. */
export function folderIdentity(db: DatabaseSync, project: string): string {
  // present es el último resultado del descubrimiento y puede estar desactualizado durante el arranque.
  const row = db.prepare("SELECT path FROM projects WHERE id=? AND registered=1 AND path IS NOT NULL").get(project) as
    | ProjectPath
    | undefined;
  if (!row) throw new Error("Elige un proyecto registrado con una carpeta presente en este equipo.");
  // El padre puede tener un alias del sistema, como /var en macOS. La carpeta elegida debe ser un directorio real.
  const selected = fs.lstatSync(row.path, { bigint: true });
  const exact = realpath(row.path);
  const stat = fs.lstatSync(exact, { bigint: true });
  if (!selected.isDirectory() || !stat.isDirectory() || selected.dev !== stat.dev || selected.ino !== stat.ino)
    throw new Error("Elige la carpeta del proyecto en este equipo.");
  return JSON.stringify([exact, String(stat.dev), String(stat.ino)]);
}
export function folderPermissions(db: DatabaseSync, peer: string, managed: boolean) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_folder_permissions(peer TEXT NOT NULL,project TEXT NOT NULL,choice INTEGER NOT NULL DEFAULT 0,root TEXT,remote INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(peer,project));
    CREATE TABLE IF NOT EXISTS sync_folder_conflicts(peer TEXT NOT NULL,project TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(peer,project,path));`);
  const entries = new Map(
    (
      db.prepare("SELECT project,choice,root,remote FROM sync_folder_permissions WHERE peer=?").all(peer) as Grant[]
    ).map((row) => [row.project, row]),
  );
  function row(id: string): Grant {
    return entries.get(id) ?? { project: id, choice: 0, remote: 0, root: null };
  }
  function save(g: Grant) {
    db.prepare(
      "INSERT INTO sync_folder_permissions(peer,project,choice,root,remote) VALUES(?,?,?,?,?) ON CONFLICT(peer,project) DO UPDATE SET choice=excluded.choice,root=excluded.root,remote=excluded.remote",
    ).run(peer, g.project, g.choice, g.root, g.remote);
    entries.set(g.project, g);
  }
  function enabled(id: string): boolean {
    const g = entries.get(id);
    if (!g?.root || g.choice <= 0) return false;
    try {
      return g.root === folderIdentity(db, id);
    } catch {
      return false;
    }
  }
  function set(id: string, on: boolean) {
    if (on && row(id).choice <= 0 && [...entries.values()].filter((g) => g.choice > 0).length >= FOLDER_LIMIT)
      throw new Error("Elige un máximo de 256 carpetas por pareja.");
    const root = on ? folderIdentity(db, id) : null;
    save({ ...row(id), root, choice: on ? 1 : -1 });
  }
  function reconcileManaged(id: string): boolean {
    const g = row(id);
    if (!managed || !g.remote || g.choice !== 0) return false;
    const found = db.prepare("SELECT folder FROM sync_work_origins WHERE peer=? AND project=?").get(peer, id) as
      | { folder: string }
      | undefined;
    if (!found) return false;
    let root: string;
    try {
      root = folderIdentity(db, id);
    } catch {
      return false;
    }
    if (found.folder !== root) return false;
    save({ ...g, root, choice: 2 });
    return true;
  }
  function remote(ids: Set<string>): void {
    for (const id of new Set([...entries.keys(), ...ids])) {
      const g = row(id),
        value = Number(ids.has(id));
      if (g.remote !== value)
        save({ ...g, remote: value, ...(!value && g.choice === 2 ? { choice: 0, root: null } : {}) });
      if (value) reconcileManaged(id);
      if (!value && row(id).choice === 0) {
        db.prepare("DELETE FROM sync_folder_permissions WHERE peer=? AND project=? AND choice=0 AND remote=0").run(
          peer,
          id,
        );
        entries.delete(id);
      }
    }
  }
  function conflicts(id: string): number {
    return Number(
      db.prepare("SELECT count(*) AS n FROM sync_folder_conflicts WHERE peer=? AND project=?").get(peer, id)?.n ?? 0,
    );
  }
  return {
    entries,
    enabled,
    set,
    remote,
    conflicts,
    reconcileManaged,
    conflict(id: string, file: string) {
      db.prepare("INSERT OR IGNORE INTO sync_folder_conflicts(peer,project,path) VALUES(?,?,?)").run(peer, id, file);
    },
    clear() {
      db.prepare("DELETE FROM sync_folder_permissions WHERE peer=?").run(peer);
      db.prepare("DELETE FROM sync_folder_conflicts WHERE peer=?").run(peer);
      entries.clear();
    },
  };
}
