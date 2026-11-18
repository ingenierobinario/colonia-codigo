import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StringDecoder } from "node:string_decoder";
import type { ProjectBackupScope } from "@colonia/protocol";
import { distinctWorkPaths } from "@colonia/protocol/project-files";
import { MIGRATIONS } from "../db/migrations.ts";
import { isInside, real, realpath, samePath } from "../paths.ts";
import { ArchiveError, readArchive, writeArchive } from "./archive.ts";
import type { CreateDeps, Progress } from "./create.ts";
import { type FileEntry, type Manifest, PRIVATE_PROJECT_FORMAT, type Summary } from "./inventory.ts";
import { addProjectFile, cleanProjectDefinition, projectFileAllowed, projectFiles } from "./project-files.ts";
import {
  indexId,
  insertRecord,
  makeIds,
  normalized,
  type RecordRow,
  restoreFlows,
  type Section,
  sectionNames,
  sourceFlows,
  sourceIds,
  sourceRows,
  validRecordId,
} from "./project-records.ts";

const bad = () => new ArchiveError("broken");

function reserveFolder(parent: string, prefix: string): string {
  const created = fs.mkdtempSync(path.toNamespacedPath(path.join(parent, prefix)));
  return path.join(realpath(parent), path.basename(created));
}
const RECORD_LIMIT = 32 * 1024 * 1024;
const FLOW_LIMIT = 64 * 1024 * 1024;
const ENTRY_LIMIT = 1_000_000;
const blankSummary = (): Summary => ({
  projects: 0,
  chats: 0,
  messages: 0,
  flows: 0,
  agents: 0,
  channels: 0,
  memories: 0,
  browsers: 0,
  apps: 0,
  providers: 0,
  people: 0,
  routines: 0,
});
const countAs: Partial<Record<Section, keyof Summary>> = {
  projects: "projects",
  threads: "chats",
  messages: "messages",
  agents: "agents",
  memories: "memories",
  routines: "routines",
};
const registeredRoots = (db: DatabaseSync, except: string) =>
  db
    .prepare("SELECT path FROM projects WHERE id<>? AND path IS NOT NULL AND path<>''")
    .all(except)
    .map((r) => String(r.path));

function mediaEntry(source: string, sourceRoot: string, size: number): FileEntry {
  const root = real(sourceRoot);
  const written = path.resolve(source);
  const rel = path.relative(isInside(root, written) ? root : path.resolve(sourceRoot), written);
  const abs = path.resolve(root, rel);
  const stat = fs.lstatSync(abs);
  if (
    !path.isAbsolute(source) ||
    !isInside(root, abs) ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size !== size ||
    !samePath(realpath(written), abs)
  )
    throw bad();
  return { abs, rel: path.relative(root, abs).split(path.sep).join("/"), size };
}
const writeAll = (fd: number, bytes: Buffer) => {
  for (let n = 0; n < bytes.length; ) {
    const written = fs.writeSync(fd, bytes, n, bytes.length - n);
    if (!written) throw bad();
    n += written;
  }
};

/** La base original solo se lee. El archivo contiene filas permitidas del proyecto y ningún archivo SQLite. */
export async function createProjectCopy(
  deps: CreateDeps,
  projectId: string,
  file: string,
  password: string,
  progress: Progress,
) {
  const now = (deps.now ?? (() => new Date()))();
  const db = new DatabaseSync(path.join(deps.home, "colonia.db"), { readOnly: true });
  const temp = reserveFolder(deps.home, ".exportar-proyecto-");
  const records = path.join(temp, "filas");
  const media: { name: string; file: FileEntry }[] = [];
  const mediaRoot = path.join(deps.home, "media");
  const part = `${file}.${path.basename(temp)}.parcial`;
  try {
    db.exec("BEGIN");
    const p = db.prepare("SELECT id,name,path FROM projects WHERE id=? AND registered=1").get(projectId);
    if (!p || typeof p.path !== "string" || !validRecordId(p.id)) throw new ArchiveError("scope");
    const id = String(p.id),
      root = p.path,
      name = String(p.name);
    const files = await projectFiles(root, deps.home, registeredRoots(db, id));
    const ids = sourceIds(db, id);
    if (!distinctWorkPaths(files.map((entry) => entry.rel))) throw bad();
    const definitions = sourceFlows(db, id, name);
    const flows = Buffer.from(JSON.stringify(definitions));
    if (flows.length > FLOW_LIMIT) throw bad();
    const summary = blankSummary();
    summary.flows = definitions.length;
    const fd = fs.openSync(records, "wx", 0o600);
    try {
      for (const section of sectionNames) {
        for (const row of sourceRows(db, id, section)) {
          const stored = normalized(section, row, ids);
          if (!stored) continue;
          if (section === "media") {
            const src = db.prepare("SELECT path FROM media WHERE id=?").get(String(row.id));
            media.push({ name: String(row.id), file: mediaEntry(String(src?.path), mediaRoot, Number(row.bytes)) });
          }
          const line = Buffer.from(`${JSON.stringify([section, stored])}\n`);
          if (line.length > RECORD_LIMIT) throw bad();
          writeAll(fd, line);
          const counter = countAs[section];
          if (counter) summary[counter]++;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    db.exec("COMMIT");
    const bytes =
      fs.statSync(records).size +
      flows.length +
      files.reduce((n, f) => n + (f.archiveBytes ?? f.size), 0) +
      media.reduce((n, f) => n + f.file.size, 0);
    const manifest: Manifest = {
      format: PRIVATE_PROJECT_FORMAT,
      scope: { kind: "project", project_id: id, name },
      created_at: now.toISOString(),
      app_version: deps.version,
      schema_version: MIGRATIONS.length,
      from: { home: "", homedir: "", home_id: "", host: os.hostname(), platform: process.platform },
      summary,
      secrets: 0,
      channels: [],
      external: [],
      files: files.length + media.length,
      bytes,
    };
    if (manifest.files > ENTRY_LIMIT) throw bad();
    const writer = await writeArchive(part, password, { created_at: manifest.created_at, app_version: deps.version });
    try {
      await writer.add("manifest.json", Buffer.from(JSON.stringify(manifest)));
      await writer.addFile("records.ndjson", records);
      await writer.add("flows.json", flows);
      let done = fs.statSync(records).size + flows.length;
      progress("files", done, bytes);
      for (const f of files) {
        await addProjectFile(writer, `files/${f.rel.normalize("NFC")}`, root, f);
        done += f.archiveBytes ?? f.size;
        progress("files", done, bytes);
      }
      for (const m of media) {
        await addProjectFile(writer, `media/${m.name}`, mediaRoot, m.file);
        done += m.file.size;
        progress("files", done, bytes);
      }
      await writer.close();
      // No sustituye otra copia si dos procesos eligen el mismo nombre.
      try {
        fs.linkSync(part, file);
      } catch (err) {
        if (
          !["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
            (err as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw err;
        fs.copyFileSync(part, file, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {
      writer.abort();
      throw error;
    }
    return manifest;
  } finally {
    db.close();
    fs.rmSync(part, { force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function eachRecord(file: string, visit: (section: Section, row: RecordRow) => void) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for (;;) {
      const n = fs.readSync(fd, buf);
      if (!n) break;
      pending += decoder.write(buf.subarray(0, n));
      let pos = pending.indexOf("\n");
      while (pos >= 0) {
        if (pos > RECORD_LIMIT) throw bad();
        const value: unknown = JSON.parse(pending.slice(0, pos));
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          !sectionNames.includes(value[0]) ||
          !value[1] ||
          typeof value[1] !== "object" ||
          Array.isArray(value[1])
        )
          throw bad();
        visit(value[0], value[1] as RecordRow);
        pending = pending.slice(pos + 1);
        pos = pending.indexOf("\n");
      }
      if (pending.length > RECORD_LIMIT) throw bad();
    }
    if (pending || decoder.end()) throw bad();
  } finally {
    fs.closeSync(fd);
  }
}
function destinationParent(db: DatabaseSync, home: string, chosen?: string) {
  const managed = real(path.join(home, "projects"));
  const typed = chosen?.trim() || managed;
  if (!path.isAbsolute(typed)) throw new ArchiveError("folder");
  const parent = real(typed);
  if (
    (isInside(real(home), parent) && !samePath(parent, managed)) ||
    registeredRoots(db, "").some((p) => isInside(real(p), parent))
  )
    throw new ArchiveError("folder");
  const entry = fs.lstatSync(typed, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory()) throw new ArchiveError("folder");
  fs.mkdirSync(parent, { recursive: true });
  return parent;
}
function fileTarget(root: string, rel: string) {
  const dst = path.join(root, ...rel.split("/"));
  if (!isInside(root, dst)) throw bad();
  let parent = root;
  for (const part of rel.split("/").slice(0, -1)) {
    parent = path.join(parent, part);
    const st = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (st && !st.isDirectory()) throw bad();
    if (!st) fs.mkdirSync(parent, { mode: 0o700 });
  }
  if (!samePath(realpath(parent), parent)) throw bad();
  return dst;
}

/** Descifra enteramente en carpetas reservadas. Solo después escribe la base local en una transacción. */
export async function restoreProjectCopy(
  db: DatabaseSync,
  home: string,
  file: string,
  password: string,
  manifest: Manifest,
  destination: string | undefined,
  progress: (done: number, total: number) => void,
) {
  const scope: ProjectBackupScope | undefined = manifest.scope;
  if (manifest.format !== PRIVATE_PROJECT_FORMAT || !scope) throw bad();
  const parent = destinationParent(db, home, destination);
  const label =
    scope.name
      .normalize("NFKD")
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 45) || "proyecto";
  const root = reserveFolder(parent, `${label}-`);
  const temp = reserveFolder(home, ".importar-proyecto-");
  const ids = makeIds();
  let mediaFolder: string | undefined;
  let open: number | undefined;
  let committed = false;
  try {
    const pathKeys = new Set<string>();
    const workPaths: string[] = [];
    const media = new Map<string, number>();
    const records = path.join(temp, "filas");
    const flows = path.join(temp, "flows");
    let header = false,
      total = 0,
      files = 0;
    await readArchive(file, password, (meta) => {
      if (!header) {
        if (meta.p !== "manifest.json" || meta.n > 4 * 1024 * 1024) throw bad();
        const chunks: Buffer[] = [];
        return {
          write(b) {
            chunks.push(Buffer.from(b));
          },
          end() {
            const first: unknown = JSON.parse(Buffer.concat(chunks).toString());
            if (JSON.stringify(first) !== JSON.stringify(manifest)) throw bad();
            header = true;
          },
        };
      }
      const key = meta.p.normalize("NFC").toLowerCase();
      if (pathKeys.has(key) || total + meta.n > manifest.bytes) throw bad();
      pathKeys.add(key);
      let target: string;
      if (meta.p === "records.ndjson") target = records;
      else if (meta.p === "flows.json" && meta.n <= FLOW_LIMIT) target = flows;
      else if (meta.p.startsWith("files/") && projectFileAllowed(meta.p.slice(6))) {
        const rel = meta.p.slice(6);
        workPaths.push(rel);
        if ((rel === ".apc/organization.json" || rel === ".apc/mcps.json") && meta.n > 2 * 1024 * 1024) throw bad();
        target = fileTarget(root, rel.normalize("NFC"));
        files++;
      } else if (meta.p.startsWith("media/") && validRecordId(meta.p.slice(6))) {
        media.set(meta.p.slice(6), meta.n);
        files++;
        target = fileTarget(temp, `medios/adjunto-${meta.p.slice(6)}`);
      } else throw bad();
      if (files > manifest.files || files > ENTRY_LIMIT) throw bad();
      open = fs.openSync(target, "wx", 0o600);
      const fd = open;
      return {
        write(b) {
          writeAll(fd, b);
          total += b.length;
          progress(total, manifest.bytes);
        },
        end() {
          fs.closeSync(fd);
          open = undefined;
        },
      };
    });
    if (
      !header ||
      total !== manifest.bytes ||
      files !== manifest.files ||
      !fs.existsSync(records) ||
      !fs.existsSync(flows)
    )
      throw bad();
    if (!distinctWorkPaths(workPaths)) throw bad();
    for (const rel of [".apc/organization.json", ".apc/mcps.json"]) {
      const target = fileTarget(root, rel);
      if (!fs.existsSync(target)) continue;
      const clean = cleanProjectDefinition(rel, fs.readFileSync(target));
      if (!clean) throw bad();
      fs.writeFileSync(target, clean);
    }
    let projectRow: RecordRow | undefined;
    const counts = blankSummary();
    eachRecord(records, (section, row) => {
      indexId(ids, section, row, true);
      if (section === "media" && media.get(String(row.id)) !== row.bytes) throw bad();
      if (section === "projects") projectRow = row;
      const counter = countAs[section];
      if (counter) counts[counter]++;
    });
    const project = ids.get("projects")?.get(scope.project_id);
    if (!project || counts.projects !== 1 || projectRow?.name !== scope.name || media.size !== ids.get("media")?.size)
      throw bad();
    const incomingFlows: unknown = JSON.parse(fs.readFileSync(flows, "utf8"));
    if (!Array.isArray(incomingFlows)) throw bad();
    counts.flows = incomingFlows.length;
    if ((Object.keys(counts) as (keyof Summary)[]).some((key) => counts[key] !== manifest.summary[key])) throw bad();
    if (media.size) {
      const mediaRoot = path.join(home, "media");
      fs.mkdirSync(mediaRoot, { recursive: true });
      if (!fs.lstatSync(mediaRoot).isDirectory()) throw bad();
      mediaFolder = reserveFolder(realpath(mediaRoot), "proyecto-");
      for (const old of media.keys()) {
        const id = ids.get("media")?.get(old);
        if (!id) throw bad();
        fs.renameSync(path.join(temp, "medios", `adjunto-${old}`), path.join(mediaFolder, id));
      }
    }
    const meta = fileTarget(root, ".apc/project.json");
    fs.writeFileSync(
      meta,
      JSON.stringify({
        colonia_id: project.slice(2),
        name: scope.name,
        kind: projectRow?.kind,
        description: projectRow?.description,
      }),
      { flag: "wx", mode: 0o600 },
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("PRAGMA defer_foreign_keys=ON");
      eachRecord(records, (section, original) => {
        const row = normalized(section, original, ids);
        if (row) insertRecord(db, section, row, project, root, (id) => path.join(mediaFolder ?? "", id));
      });
      restoreFlows(db, incomingFlows, project, scope.name);
      db.exec("COMMIT");
      committed = true;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return { id: project, name: scope.name, path: root };
  } finally {
    if (open !== undefined) fs.closeSync(open);
    fs.rmSync(temp, { recursive: true, force: true });
    if (!committed) {
      fs.rmSync(root, { recursive: true, force: true });
      if (mediaFolder) fs.rmSync(mediaFolder, { recursive: true, force: true });
    }
  }
}
