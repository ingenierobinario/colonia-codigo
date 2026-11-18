import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { distinctWorkPaths, shareableWorkPath, WORK_FILE_MAX, WORK_FILES_MAX } from "@colonia/protocol/project-files";
import { PACKAGE_MAX, scrub } from "../domain/project-package.ts";
import type { WorkFile } from "../domain/work-file-payload.ts";
import { badRequest } from "../errors.ts";
import { insideReal, realpath } from "../paths.ts";

export const workFilesDigest = (files: WorkFile[]) => createHash("sha256").update(JSON.stringify(files)).digest("hex");

function checkSelection(files: string[]) {
  if (files.length > WORK_FILES_MAX || !files.every(shareableWorkPath) || !distinctWorkPaths(files))
    throw badRequest("work files: private or non-portable name");
}

/** Comprueba los padres uno por uno; también excluye enlaces dentro del propio proyecto. */
function directory(root: string, rel: string, create: boolean): boolean {
  let full = root;
  for (const part of rel.split("/").slice(0, -1)) {
    full = path.join(full, part);
    if (create) {
      try {
        fs.mkdirSync(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!fs.lstatSync(full, { throwIfNoEntry: false })?.isDirectory() || !insideReal(root, full)) return false;
  }
  return true;
}

export function selectedWorkFiles(rootPath: string, names: string[]): WorkFile[] {
  checkSelection(names);
  if (!names.length) return [];
  const root = realpath(rootPath);
  let size = 0;
  return names.toSorted().map((rel) => {
    const full = path.join(root, rel);
    const refuse = () => badRequest("work files: unavailable, private or too large");
    if (!directory(root, rel, false) || !insideReal(root, full)) throw refuse();
    const entry = fs.lstatSync(full, { throwIfNoEntry: false });
    if (!entry?.isFile() || entry.nlink !== 1 || entry.size > WORK_FILE_MAX) throw refuse();
    let fd: number;
    try {
      fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    } catch {
      throw refuse();
    }
    try {
      const current = fs.fstatSync(fd);
      if (
        !current.isFile() ||
        entry.dev !== current.dev ||
        entry.ino !== current.ino ||
        current.nlink !== 1 ||
        current.size > WORK_FILE_MAX ||
        !directory(root, rel, false) ||
        !insideReal(root, full)
      )
        throw refuse();
      size += Math.ceil(current.size / 3) * 4;
      if (size > PACKAGE_MAX) throw badRequest("work files: package too large");
      const bytes = Buffer.alloc(current.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const read = fs.readSync(fd, bytes, count, bytes.length - count, null);
        if (!read) break;
        count += read;
      }
      if (count !== current.size) throw refuse();
      const data = bytes.subarray(0, count);
      if (scrub(data.toString("utf8")).removed || (data.includes(0) && scrub(data.toString("utf16le")).removed))
        throw refuse();
      return { path: rel.normalize("NFC"), data: data.toString("base64") };
    } finally {
      fs.closeSync(fd);
    }
  });
}

/** Un nombre ya ocupado, incluso por un enlace o una carpeta, se conserva tal cual. */
export function importWorkFiles(rootPath: string, files: WorkFile[]): string[] {
  if (!files.length) return [];
  const root = realpath(rootPath);
  const kept: string[] = [];
  for (const file of files) {
    const full = path.join(root, file.path);
    if (!directory(root, file.path, true) || !insideReal(root, full)) {
      kept.push(file.path);
      continue;
    }
    if (fs.lstatSync(full, { throwIfNoEntry: false })) {
      kept.push(file.path);
      continue;
    }
    const temp = path.join(path.dirname(full), `.colonia-import-${randomUUID()}.tmp`);
    const fd = fs.openSync(temp, "wx", 0o600);
    const ours = fs.fstatSync(fd);
    try {
      if (!directory(root, file.path, false) || !insideReal(root, temp)) throw badRequest("work files: folder changed");
      fs.writeFileSync(fd, Buffer.from(file.data, "base64"));
      if (!directory(root, file.path, false) || !insideReal(root, temp)) throw badRequest("work files: folder changed");
      try {
        // Enlazar la copia terminada es atómico y nunca sustituye un archivo local.
        fs.linkSync(temp, full);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOTSUP" && code !== "EOPNOTSUPP" && code !== "EPERM" && code !== "ENOSYS") throw error;
        // Volúmenes sin enlaces duros, como exFAT.
        fs.copyFileSync(temp, full, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      kept.push(file.path);
    } finally {
      fs.closeSync(fd);
      const entry = fs.lstatSync(temp, { throwIfNoEntry: false });
      if (entry?.dev === ours.dev && entry.ino === ours.ino && insideReal(root, temp)) fs.unlinkSync(temp);
    }
  }
  return kept;
}
