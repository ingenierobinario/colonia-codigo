import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { distinctWorkPaths } from "@colonia/protocol/project-files";
import { reserveFolder, writeAll } from "../backup/project-file-io.ts";
import { projectFileScope, projectFiles } from "../backup/project-files.ts";
import { samePath } from "../paths.ts";
import {
  bytesAt,
  checkedDirectory,
  checkVersion,
  chunkMax,
  conflictPath,
  digest,
  type FolderRevision,
  fingerprint,
  identity,
  inParent,
  isOrganization,
  liveAllowed,
  liveExcluded,
  openRegular,
  organizationBytes,
  preserveLocalOrganization,
  regularFile,
  sameFile,
  sameVersion,
  stamp,
  unavailable,
} from "./continuous-folder-disk.ts";

export type { FolderRevision } from "./continuous-folder-disk.ts";

type Options = { db: DatabaseSync; home: string; peer: string; project: string; active: () => boolean };
const maximum = 100_000;
const locks = new Map<string, Promise<void>>();

export function continuousFolderStore({ db, home, peer, project, active }: Options) {
  const check = () => {
    if (!active()) throw new Error("La carpeta ya no está autorizada para la sincronización.");
  };
  const roots = () => {
    check();
    const current = db.prepare("SELECT path FROM projects WHERE id=? AND registered=1").get(project);
    if (typeof current?.path !== "string") throw unavailable();
    const other = db
      .prepare("SELECT path FROM projects WHERE id<>? AND path IS NOT NULL")
      .all(project)
      .map((r) => String(r.path));
    return { root: current.path, other };
  };
  const registered = roots();
  const initial = projectFileScope(registered.root, home, registered.other);
  const root = initial.base,
    rootId = checkedDirectory(root);
  const scope = digest(JSON.stringify([root, rootId, project, peer]));
  const cacheScope = digest(JSON.stringify([root, rootId, project]));
  db.exec(`CREATE TABLE IF NOT EXISTS sync_folder_baselines(scope TEXT,path TEXT,sha TEXT,bytes INTEGER,PRIMARY KEY(scope,path));
    CREATE TABLE IF NOT EXISTS sync_folder_cache(scope TEXT,path TEXT,stamp TEXT,sha TEXT,bytes INTEGER,PRIMARY KEY(scope,path));
    CREATE TABLE IF NOT EXISTS sync_folder_stage(scope TEXT PRIMARY KEY,name TEXT NOT NULL,identity TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_folder_parts(scope TEXT,path TEXT,name TEXT,updated INTEGER,identity TEXT NOT NULL,PRIMARY KEY(scope,path));
    CREATE TABLE IF NOT EXISTS sync_folder_links(scope TEXT,name TEXT,path TEXT,PRIMARY KEY(scope,name));
    CREATE TABLE IF NOT EXISTS sync_folder_claims(scope TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,oldSha TEXT NOT NULL,oldBytes INTEGER NOT NULL,oldId TEXT NOT NULL,nextSha TEXT,nextBytes INTEGER,PRIMARY KEY(scope,name));`);
  const inspectScope = () => {
    const now = roots();
    const s = projectFileScope(now.root, home, now.other);
    if (!samePath(root, s.base) || rootId !== checkedDirectory(root)) throw unavailable();
    return { ...now, reserved: s.reserved };
  };
  type Scope = ReturnType<typeof inspectScope>;
  function permitted(rel: string, s: Scope) {
    if (typeof rel !== "string" || !liveAllowed(rel) || rel !== rel.normalize("NFC")) throw unavailable();
    const parts = rel.toLowerCase().split("/");
    for (let n = 1; n <= parts.length; n++) if (s.reserved.has(parts.slice(0, n).join("/"))) throw unavailable();
  }
  // Validar cada padre existente también al confirmar una recepción iniciada antes de la desconexión.
  const aliasesByDirectory = new Map<string, { stamp: string; entries: Map<string, string | null> }>();
  function existingSpelling(dir: string, part: string) {
    const marker = stamp(fs.lstatSync(dir, { bigint: true }));
    let cache = aliasesByDirectory.get(dir);
    if (!cache || cache.stamp !== marker) {
      const entries = new Map<string, string | null>();
      for (const name of fs.readdirSync(dir)) {
        const key = name.normalize("NFC").toLowerCase();
        entries.set(key, entries.has(key) ? null : name);
      }
      if (aliasesByDirectory.size >= 128) aliasesByDirectory.clear();
      cache = { stamp: marker, entries };
      aliasesByDirectory.set(dir, cache);
    }
    return cache.entries.get(part.toLowerCase());
  }
  function target(rel: string, s: Scope, create = false, aliases = false) {
    permitted(rel, s);
    let dir = root;
    const parts = rel.split("/");
    for (const [i, part] of parts.entries()) {
      const next = path.join(dir, part);
      if (aliases) {
        const spelling = existingSpelling(dir, part);
        if (spelling === null || (spelling && (spelling.normalize("NFC") !== part || !fs.existsSync(next))))
          throw unavailable();
      }
      if (i === parts.length - 1) return next;
      const st = fs.lstatSync(next, { throwIfNoEntry: false });
      if (!st) {
        if (!create) return path.join(root, ...parts);
        inParent(next, (name) => fs.mkdirSync(name, { mode: 0o700 }));
      }
      checkedDirectory(next);
      dir = next;
    }
    throw unavailable();
  }
  const fromRow = (r: Record<string, unknown>) => ({ sha: String(r.sha), bytes: Number(r.bytes) });
  const cached = db.prepare("SELECT sha,bytes FROM sync_folder_cache WHERE scope=? AND path=? AND stamp=?");
  const saveCache = db.prepare(
    "INSERT OR REPLACE INTO sync_folder_cache(scope,path,stamp,sha,bytes) VALUES(?,?,?,?,?)",
  );
  type CacheEntry = [string, string, string, string, number];
  async function current(rel: string, s: Scope, batch?: CacheEntry[]) {
    const name = target(rel, s);
    const before = regularFile(name);
    if (!before) return null;
    const key = stamp(before),
      hit = cached.get(cacheScope, rel, key);
    if (hit) return fromRow(hit);
    const value = await fingerprint(name, rel, check);
    const after = regularFile(name);
    if (!after || stamp(after) !== key) throw unavailable();
    const entry: CacheEntry = [cacheScope, rel, key, value.sha, value.bytes];
    if (batch) batch.push(entry);
    else saveCache.run(...entry);
    return value;
  }
  let staging: { dir: string; id: string } | undefined;
  function stage() {
    const s = inspectScope();
    if (!staging) {
      const row = db.prepare("SELECT name,identity FROM sync_folder_stage WHERE scope=?").get(scope);
      if (row) {
        const name = String(row.name);
        if (!/^\.colonia-sincronizar-[a-zA-Z0-9]+$/.test(name)) throw unavailable();
        staging = { dir: path.join(root, name), id: String(row.identity) };
      } else {
        const dir = reserveFolder(root, ".colonia-sincronizar-");
        const id = checkedDirectory(dir);
        db.prepare("INSERT INTO sync_folder_stage(scope,name,identity) VALUES(?,?,?)").run(
          scope,
          path.basename(dir),
          id,
        );
        staging = { dir, id };
      }
    }
    if (checkedDirectory(staging.dir) !== staging.id || s.reserved.has(path.relative(root, staging.dir).toLowerCase()))
      throw unavailable();
    return staging.dir;
  }
  const baseRows = () =>
    db.prepare("SELECT path,sha,bytes FROM sync_folder_baselines WHERE scope=? ORDER BY path").all(scope);
  function baselines() {
    inspectScope();
    return baseRows().map((r) => ({ path: String(r.path), version: r.sha === null ? null : fromRow(r) }));
  }
  function ack(rel: string, version: FolderRevision | null) {
    checkVersion(version);
    regularFile(target(rel, inspectScope()));
    // La confirmación proviene del protocolo autenticado; una edición posterior se compara con esta base.
    if (!version) {
      db.prepare("DELETE FROM sync_folder_baselines WHERE scope=? AND path=?").run(scope, rel);
    } else {
      db.prepare("INSERT OR REPLACE INTO sync_folder_baselines(scope,path,sha,bytes) VALUES(?,?,?,?)").run(
        scope,
        rel,
        version.sha,
        version.bytes,
      );
    }
  }
  async function scan() {
    const s = inspectScope();
    await recover();
    const files = await projectFiles(s.root, home, s.other, { exclude: liveExcluded, maxFiles: maximum });
    if (!distinctWorkPaths(files.map((f) => f.rel))) throw unavailable();
    const list = [];
    const batch: CacheEntry[] = [];
    function flush() {
      if (!batch.length) return;
      db.exec("SAVEPOINT continuous_cache");
      try {
        for (const row of batch) saveCache.run(...row);
        db.exec("RELEASE continuous_cache");
        batch.length = 0;
      } catch (error) {
        db.exec("ROLLBACK TO continuous_cache; RELEASE continuous_cache");
        throw error;
      }
    }
    for (const [i, f] of files.entries()) {
      if (i % 64 === 0) {
        await yieldTurn();
        check();
      }
      const rel = f.rel.normalize("NFC");
      const v = await current(rel, s, batch);
      if (batch.length >= 64) flush();
      if (!v) throw unavailable();
      list.push({ path: rel, ...v });
    }
    flush();
    // Si un archivo confirmado pasa a ser un enlace, privado o de otro proyecto, no inventar un borrado.
    const present = new Set(list.map((entry) => entry.path));
    for (const [i, row] of baseRows().entries()) {
      if (i % 64 === 0) {
        await yieldTurn();
        check();
      }
      const rel = String(row.path);
      if (!present.has(rel) && regularFile(target(rel, s, false, true))) throw unavailable();
    }
    const latest = inspectScope();
    if (JSON.stringify([...s.reserved].sort()) !== JSON.stringify([...latest.reserved].sort())) throw unavailable();
    return list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  async function read(rel: string, version: FolderRevision, offset: number, length: number) {
    checkVersion(version);
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > chunkMax ||
      offset + length > version.bytes
    )
      throw unavailable();
    const s = inspectScope();
    if (!sameVersion(await current(rel, s), version)) throw unavailable();
    const name = target(rel, inspectScope());
    const { fd, before } = openRegular(name);
    try {
      const hit = cached.get(cacheScope, rel, stamp(before));
      if (!hit || !sameVersion(fromRow(hit), version)) throw unavailable();
      const bytes = isOrganization(rel)
        ? organizationBytes(fd, Number(before.size)).subarray(offset, offset + length)
        : bytesAt(fd, offset, length);
      if (!sameFile(fd, name, before)) throw unavailable();
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  }
  const writableDirectories = new Set<string>();
  function checkPublication(directory: string) {
    const key = directory + checkedDirectory(directory);
    if (writableDirectories.has(key)) return;
    const name = `.colonia-comprobar-${randomUUID()}`;
    const probe = path.join(stage(), name);
    const visible = path.join(directory, name);
    const fd = fs.openSync(probe, "wx", 0o600);
    fs.closeSync(fd);
    let linked = false;
    try {
      inParent(probe, (source) => inParent(visible, (target) => fs.linkSync(source, target)));
      linked = true;
      inParent(visible, (entry) => fs.unlinkSync(entry));
      linked = false;
      writableDirectories.add(key);
    } catch (error) {
      throw new Error(
        "El sistema de archivos debe admitir enlaces físicos para sustituir documentos de forma segura.",
        { cause: error },
      );
    } finally {
      if (!linked) inParent(probe, (entry) => fs.unlinkSync(entry));
    }
  }
  // El enlace exclusivo publica un archivo ya completo. Si el sistema no lo admite, el original queda a salvo.
  function publish(part: string, rel: string, expected?: string) {
    const dir = stage(),
      to = target(rel, inspectScope(), true, true);
    const info = regularFile(part);
    if (path.dirname(part) !== dir || !info || (expected && stamp(info) !== expected)) throw unavailable();
    check();
    const name = path.basename(part);
    db.prepare("INSERT OR REPLACE INTO sync_folder_links(scope,name,path) VALUES(?,?,?)").run(scope, name, rel);
    inParent(part, (source) => inParent(to, (destination) => fs.linkSync(source, destination)));
    inParent(part, (name) => fs.unlinkSync(name));
    db.prepare("DELETE FROM sync_folder_links WHERE scope=? AND name=?").run(scope, name);
  }
  const forget = (name: string) =>
    db.prepare("DELETE FROM sync_folder_claims WHERE scope=? AND name=?").run(scope, name);
  async function recover() {
    for (const link of db.prepare("SELECT name,path FROM sync_folder_links WHERE scope=?").all(scope)) {
      const name = String(link.name);
      if (!/^(?:[0-9a-f]{64}|(?:anterior|conflicto)-[0-9a-f-]{36})$/.test(name)) throw unavailable();
      const part = path.join(stage(), name);
      const to = target(String(link.path), inspectScope());
      const a = fs.lstatSync(part, { bigint: true, throwIfNoEntry: false }),
        b = fs.lstatSync(to, { bigint: true, throwIfNoEntry: false });
      if (a && b && a.isFile() && b.isFile() && a.nlink === 2n && a.dev === b.dev && a.ino === b.ino)
        fs.unlinkSync(part);
      db.prepare("DELETE FROM sync_folder_links WHERE scope=? AND name=?").run(scope, name);
    }
    const rows = db
      .prepare("SELECT name,path,oldSha,oldBytes,oldId,nextSha,nextBytes FROM sync_folder_claims WHERE scope=?")
      .all(scope);
    for (const row of rows) {
      const rel = String(row.path),
        name = String(row.name);
      if (!/^anterior-[a-f0-9-]{36}$/.test(name)) throw unavailable();
      const previous = path.join(stage(), name),
        to = target(rel, inspectScope(), true, true);
      const st = fs.lstatSync(previous, { bigint: true, throwIfNoEntry: false });
      if (!st) {
        forget(name);
        continue;
      }
      if (identity(st) !== row.oldId) throw unavailable();
      const occupant = fs.lstatSync(to, { bigint: true, throwIfNoEntry: false });
      if (occupant && st.isFile() && st.nlink === 2n && st.dev === occupant.dev && st.ino === occupant.ino) {
        fs.unlinkSync(previous);
        forget(name);
        continue;
      }
      if (!occupant) {
        publish(previous, rel);
        forget(name);
        continue;
      }
      const old = await fingerprint(previous, rel, check);
      const visible = await current(rel, inspectScope());
      const planned = typeof row.nextSha === "string" ? { sha: row.nextSha, bytes: Number(row.nextBytes) } : null;
      const previousVersion = { sha: String(row.oldSha), bytes: Number(row.oldBytes) };
      const completed = sameVersion(visible, planned) && sameVersion(old, previousVersion);
      if (!completed && !sameVersion(old, visible)) {
        const alt = conflictPath(rel, old.sha);
        await preserve(previous, rel, alt, old);
      }
      fs.unlinkSync(previous);
      forget(name);
    }
  }
  // Sólo para conflictos: guarda una segunda copia completa antes de tocar el nombre original.
  async function preserve(source: string, rel: string, alt: string, version: FolderRevision) {
    const existing = await current(alt, inspectScope());
    if (existing) {
      if (!sameVersion(existing, version)) throw unavailable();
      return;
    }
    const part = path.join(stage(), `conflicto-${randomUUID()}`);
    const { fd, before } = openRegular(source);
    let created: string | undefined;
    try {
      const out = fs.openSync(part, "wx", 0o600);
      created = identity(fs.fstatSync(out, { bigint: true }));
      try {
        if (isOrganization(rel)) {
          writeAll(out, organizationBytes(fd, Number(before.size)));
        } else {
          for (let n = 0; n < version.bytes; n += chunkMax) {
            if (n && n % (16 * chunkMax) === 0) await yieldTurn();
            check();
            writeAll(out, bytesAt(fd, n, Math.min(chunkMax, version.bytes - n)));
          }
        }
        fs.fsyncSync(out);
      } finally {
        fs.closeSync(out);
      }
      if (!sameFile(fd, source, before) || !sameVersion(await fingerprint(part, alt, check), version))
        throw unavailable();
      publish(part, alt);
    } finally {
      fs.closeSync(fd);
      if (created) {
        stage();
        unlinkOwned(part, created);
      }
    }
  }
  function unlinkOwned(file: string, id: string) {
    const info = regularFile(file);
    if (!info) return;
    if (identity(info) !== id) throw unavailable();
    inParent(file, (entry) => fs.unlinkSync(entry));
  }
  function trackPart(rel: string, name: string) {
    const dir = stage();
    const rows = db
      .prepare("SELECT name,path,updated,identity FROM sync_folder_parts WHERE scope=? ORDER BY updated DESC")
      .all(scope);
    const now = Date.now();
    for (const [i, row] of rows.entries()) {
      if (row.name === name) continue;
      if (row.path !== rel && i < 15 && now - Number(row.updated) < 7 * 24 * 60 * 60 * 1000) continue;
      if (!/^[a-f0-9]{64}$/.test(String(row.name))) throw unavailable();
      const part = path.join(dir, String(row.name));
      unlinkOwned(part, String(row.identity));
      db.prepare("DELETE FROM sync_folder_parts WHERE scope=? AND path=?").run(scope, String(row.path));
    }
    const file = path.join(dir, name),
      old = rows.find((r) => r.name === name && r.path === rel);
    const current = regularFile(file);
    if (current && (!old || old.identity !== identity(current))) throw unavailable();
    if (!current) fs.closeSync(fs.openSync(file, "wx", 0o600));
    const st = regularFile(file);
    if (!st) throw unavailable();
    const id = identity(st);
    db.prepare("INSERT OR REPLACE INTO sync_folder_parts(scope,path,name,updated,identity) VALUES(?,?,?,?,?)").run(
      scope,
      rel,
      name,
      now,
      id,
    );
    return { file, id };
  }
  async function receive(rel: string, base: FolderRevision | null, version: FolderRevision | null) {
    checkVersion(base);
    checkVersion(version);
    target(rel, inspectScope(), false, true);
    const observed = await current(rel, inspectScope());
    const identical = sameVersion(observed, version);
    let part: string | undefined, partId: string | undefined;
    if (version && !identical) {
      const name = digest(JSON.stringify([rel, base?.sha ?? null, version.sha]));
      const tracked = trackPart(rel, name);
      part = tracked.file;
      partId = tracked.id;
      const file = regularFile(part);
      if (!file || file.size > BigInt(version.bytes)) throw unavailable();
    }
    let offset = part ? Number(regularFile(part)?.size) : (version?.bytes ?? 0);
    async function append(at: number, bytes: Buffer) {
      if (
        !part ||
        !version ||
        !Buffer.isBuffer(bytes) ||
        !bytes.length ||
        bytes.length > chunkMax ||
        !Number.isSafeInteger(at) ||
        at < 0 ||
        at + bytes.length > version.bytes
      )
        throw unavailable();
      target(rel, inspectScope());
      stage();
      const { fd, before } = openRegular(part, fs.constants.O_WRONLY | fs.constants.O_APPEND);
      try {
        if (identity(before) !== partId || BigInt(at) !== before.size) throw unavailable();
        check();
        writeAll(fd, bytes);
        offset = at + bytes.length;
      } finally {
        fs.closeSync(fd);
      }
    }
    function discard() {
      if (part) {
        stage();
        const owned = db
          .prepare("SELECT name,identity FROM sync_folder_parts WHERE scope=? AND path=?")
          .get(scope, rel);
        if (owned?.name === path.basename(part) && owned.identity === partId && partId) {
          unlinkOwned(part, partId);
          db.prepare("DELETE FROM sync_folder_parts WHERE scope=? AND path=?").run(scope, rel);
        }
      }
    }
    async function apply() {
      await recover();
      const dest = target(rel, inspectScope(), false, true);
      const local = await current(rel, inspectScope());
      if (sameVersion(local, version)) {
        discard();
        return { version };
      }
      let incomingStamp: string | undefined;
      if (version) {
        if (!part) throw unavailable();
        stage();
        const st = regularFile(part);
        if (!st || identity(st) !== partId || Number(st.size) !== version.bytes) throw unavailable();
        incomingStamp = stamp(st);
        const held = openRegular(part, process.platform === "win32" ? fs.constants.O_RDWR : fs.constants.O_RDONLY);
        try {
          fs.fsyncSync(held.fd);
        } finally {
          fs.closeSync(held.fd);
        }
        const actual = await fingerprint(part, "", check);
        if (!sameVersion(actual, version)) {
          discard();
          throw unavailable();
        }
        if (isOrganization(rel) && !sameVersion(await fingerprint(part, rel, check), version)) {
          discard();
          throw unavailable();
        }
      }
      let conflict: string | undefined;
      if (!sameVersion(local, base) && local) {
        if (!version) return { version: local, conflict: rel };
        const smaller = local.sha < version.sha;
        const loser = smaller ? version : local;
        conflict = conflictPath(rel, loser.sha);
        const source = smaller ? part : dest;
        if (!source) throw unavailable();
        await preserve(source, rel, conflict, loser);
        if (smaller) {
          if (!sameVersion(await current(rel, inspectScope()), local)) throw unavailable();
          discard();
          return { version: local, conflict };
        }
      }
      if (!local && !version) return { version: null };
      // No pisa el nombre si reaparece durante la sustitución. La reclamación permite recuperarse tras un corte.
      let previous: string | undefined, name: string | undefined, claimedStamp: string | undefined;
      if (local) {
        const s = inspectScope();
        const to = target(rel, s, false, true);
        const st = regularFile(to),
          hit = st && cached.get(cacheScope, rel, stamp(st));
        if (!st || !hit || !sameVersion(fromRow(hit), local)) throw unavailable();
        if (isOrganization(rel)) preserveLocalOrganization(to);
        checkPublication(path.dirname(to));
        if (part && process.platform !== "win32") {
          const { fd, before } = openRegular(part);
          try {
            if (stamp(before) !== incomingStamp) throw unavailable();
            fs.fchmodSync(fd, Number(st.mode & 0o777n));
            incomingStamp = stamp(fs.fstatSync(fd, { bigint: true }));
          } finally {
            fs.closeSync(fd);
          }
        }
        name = `anterior-${randomUUID()}`;
        previous = path.join(stage(), name);
        db.prepare(
          "INSERT INTO sync_folder_claims(scope,name,path,oldSha,oldBytes,oldId,nextSha,nextBytes) VALUES(?,?,?,?,?,?,?,?)",
        ).run(scope, name, rel, local.sha, local.bytes, identity(st), version?.sha ?? null, version?.bytes ?? null);
        check();
        inParent(to, (source) => inParent(previous as string, (target) => fs.renameSync(source, target)));
        const moved = regularFile(previous);
        if (
          !moved ||
          st.dev !== moved.dev ||
          st.ino !== moved.ino ||
          st.size !== moved.size ||
          st.mtimeNs !== moved.mtimeNs
        )
          throw unavailable();
        claimedStamp = stamp(moved);
      }
      if (part) {
        publish(part, rel, incomingStamp);
        discard();
      }
      if (previous && name) {
        const displaced = regularFile(previous);
        if (!displaced || stamp(displaced) !== claimedStamp) throw unavailable();
        inParent(previous, (entry) => fs.unlinkSync(entry));
        forget(name);
      }
      return conflict ? { version, conflict } : { version };
    }
    const commit = () =>
      locked(async () => {
        try {
          return await apply();
        } catch (error) {
          await recover();
          throw error;
        }
      });
    return {
      get offset() {
        return offset;
      },
      append,
      commit,
    };
  }
  async function locked<T>(work: () => Promise<T>) {
    const previous = locks.get(cacheScope) ?? Promise.resolve();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    locks.set(cacheScope, done);
    await previous;
    try {
      return await work();
    } finally {
      finish();
      if (locks.get(cacheScope) === done) locks.delete(cacheScope);
    }
  }
  return { inventory: () => locked(scan), baselines, ack, read, receive };
}
