import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { distinctWorkPaths } from "@colonia/protocol/project-files";
import { readArchive, writeArchive } from "../backup/archive.ts";
import { fileTarget, publishArchive, reserveFolder, writeAll } from "../backup/project-file-io.ts";
import { addProjectFile, cleanProjectDefinition, projectFileAllowed, projectFiles } from "../backup/project-files.ts";
import { realpath } from "../paths.ts";
import { workLocation } from "./project-work-location.ts";

const format = "colonia-archivos-equipo-1";
const limit = 1_000_000;
const invalid = () => new Error("No se ha podido verificar la entrega de archivos del proyecto.");
const registered = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT name,kind,description,path FROM projects WHERE id=? AND registered=1").get(id);

export async function prepareProjectWork(
  db: DatabaseSync,
  home: string,
  project: string,
  archiveFile: string,
  password: string,
) {
  const row = registered(db, project);
  if (!row || typeof row.path !== "string") throw new Error("La carpeta de este proyecto no está registrada.");
  const other = db
    .prepare("SELECT path FROM projects WHERE id<>? AND path IS NOT NULL")
    .all(project)
    .map((r) => String(r.path));
  const files = await projectFiles(row.path, home, other);
  if (files.length > limit || !distinctWorkPaths(files.map((f) => f.rel))) throw invalid();
  const summary = {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + (file.archiveBytes ?? file.size), 0),
  };
  if (!Number.isSafeInteger(summary.bytes)) throw invalid();
  const temp = reserveFolder(path.dirname(archiveFile), ".exportar-proyecto-");
  const partial = path.join(temp, "contenido");
  try {
    const writer = await writeArchive(partial, password, { created_at: new Date().toISOString(), app_version: "1" });
    try {
      await writer.add("manifest.json", Buffer.from(JSON.stringify({ format, project, ...summary })));
      for (const entry of files) await addProjectFile(writer, `files/${entry.rel.normalize("NFC")}`, row.path, entry);
      await writer.close();
      publishArchive(partial, archiveFile);
    } catch (error) {
      writer.abort();
      throw error;
    }
  } finally {
    fs.rmSync(temp, { force: true, recursive: true });
  }
  return summary;
}

export function hasProjectWork(db: DatabaseSync, peer: string, transfer: string, project: string, sha: string) {
  const receipt = db
    .prepare("SELECT project,sha FROM sync_work_receipts WHERE peer=? AND transfer=?")
    .get(peer, transfer);
  if (receipt && (receipt.project !== project || receipt.sha !== sha)) throw invalid();
  return !!receipt;
}

export async function installProjectWork(opts: {
  db: DatabaseSync;
  home: string;
  project: string;
  archiveFile: string;
  password: string;
  files: number;
  bytes: number;
  peer: string;
  transfer: string;
  sha: string;
  active?: () => boolean;
}) {
  const { db, home, project, archiveFile, password, files, bytes, peer, transfer, sha } = opts;
  const active = () => {
    if (opts.active && !opts.active()) throw new Error("La vinculación ya no está activa.");
  };
  active();
  if (!/^[a-f\d]{64}$/.test(sha)) throw invalid();
  if (hasProjectWork(db, peer, transfer, project, sha)) return;
  const before = registered(db, project);
  if (
    !before ||
    !Number.isSafeInteger(files) ||
    files < 0 ||
    files > limit ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0
  )
    throw invalid();
  const managed = path.join(realpath(home), "projects");
  fs.mkdirSync(managed, { recursive: true });
  if (!fs.lstatSync(managed).isDirectory()) throw invalid();
  const root = reserveFolder(managed, "recibido-");
  let fd: number | undefined;
  let installed = false;
  try {
    let header = false;
    let total = 0;
    const paths: string[] = [];
    await readArchive(archiveFile, password, (entry) => {
      active();
      if (!header) {
        if (entry.p !== "manifest.json" || entry.n > 4096) throw invalid();
        const parts: Buffer[] = [];
        return {
          write(part) {
            parts.push(Buffer.from(part));
          },
          end() {
            const m = JSON.parse(Buffer.concat(parts).toString("utf8"));
            if (m?.format !== format || m.project !== project || m.files !== files || m.bytes !== bytes)
              throw invalid();
            header = true;
          },
        };
      }
      const rel = entry.p.slice(6);
      if (!entry.p.startsWith("files/") || !projectFileAllowed(rel) || paths.length >= files || entry.n > bytes - total)
        throw invalid();
      const definition = rel === ".apc/organization.json" || rel === ".apc/mcps.json";
      if (definition && entry.n > 2 * 1024 * 1024) throw invalid();
      const target = fileTarget(root, rel.normalize("NFC"));
      paths.push(rel);
      fd = fs.openSync(target, "wx", 0o600);
      const out = fd;
      return {
        write(part) {
          active();
          writeAll(out, part);
          total += part.length;
        },
        end() {
          fs.closeSync(out);
          fd = undefined;
          if (definition) {
            const clean = cleanProjectDefinition(rel, fs.readFileSync(target));
            if (!clean) throw invalid();
            fs.writeFileSync(target, clean);
          }
        },
      };
    });
    if (!header || paths.length !== files || total !== bytes || !distinctWorkPaths(paths)) throw invalid();
    db.exec("BEGIN IMMEDIATE");
    try {
      active();
      if (hasProjectWork(db, peer, transfer, project, sha)) {
        db.exec("COMMIT");
        return;
      }
      const current = registered(db, project);
      if (!current || current.path !== before.path) throw invalid();
      const previous = workLocation(db, project);
      const source = previous?.local_path === current.path ? previous?.source_path : current.path;
      fs.writeFileSync(
        fileTarget(root, ".apc/project.json"),
        JSON.stringify({
          colonia_id: project.replace(/^p_/, ""),
          name: current.name,
          kind: current.kind,
          description: current.description,
        }),
        { flag: "wx", mode: 0o600 },
      );
      db.prepare(
        "INSERT INTO sync_work_locations(project,local_path,source_path) VALUES(?,?,?) ON CONFLICT(project) DO UPDATE SET local_path=excluded.local_path,source_path=excluded.source_path",
      ).run(project, root, source ?? null);
      db.prepare("UPDATE projects SET path=?,present=1 WHERE id=?").run(root, project);
      db.prepare("INSERT INTO sync_work_receipts(peer,transfer,project,sha) VALUES(?,?,?,?)").run(
        peer,
        transfer,
        project,
        sha,
      );
      db.exec("COMMIT");
      installed = true;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (!installed) fs.rmSync(root, { recursive: true, force: true });
  }
}
