import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { withoutBom } from "../apc/read.ts";
import { cleanProjectDefinition, projectFileAllowed } from "../backup/project-files.ts";
import { realpath, samePath } from "../paths.ts";

export type FolderRevision = { sha: string; bytes: number };
export const chunkMax = 256 * 1024;
export const fileMax = 8 * 1024 ** 3;
export const unavailable = () => new Error("La carpeta o el archivo han cambiado. Vuelve a sincronizar.");
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const sameVersion = (a: FolderRevision | null, b: FolderRevision | null) =>
  a === null || b === null ? a === b : a.sha === b.sha && a.bytes === b.bytes;
export function checkVersion(version: FolderRevision | null) {
  if (
    version !== null &&
    (!/^[0-9a-f]{64}$/.test(version.sha) ||
      !Number.isSafeInteger(version.bytes) ||
      version.bytes < 0 ||
      version.bytes > fileMax)
  )
    throw unavailable();
}
export const identity = (s: fs.BigIntStats) => [s.dev, s.ino, s.birthtimeNs].join(":");
export const stamp = (s: fs.BigIntStats) => [identity(s), s.size, s.mtimeNs, s.ctimeNs, s.nlink, s.mode].join(":");
export const liveExcluded = (rel: string) => rel.toLowerCase() === ".apc/mcps.json";
export const liveAllowed = (rel: string) => rel.length <= 4096 && !liveExcluded(rel) && projectFileAllowed(rel);
export const isOrganization = (rel: string) => rel === ".apc/organization.json";

function sameSpelling(actual: string, requested: string) {
  return (
    samePath(actual, requested) ||
    (process.platform === "darwin" && samePath(actual.normalize("NFC"), requested.normalize("NFC")))
  );
}
export function checkedDirectory(dir: string) {
  const s = fs.lstatSync(dir, { bigint: true });
  if (!s.isDirectory() || !sameSpelling(realpath(dir), dir)) throw unavailable();
  return identity(s);
}

/** Mantiene abierto el directorio real durante el cambio de nombre. En Linux la operación se hace
 * relativa al descriptor; en los demás sistemas se contrasta la identidad antes y después. */
export function inParent<T>(file: string, operation: (entry: string) => T): T {
  const directory = path.dirname(file),
    expected = checkedDirectory(directory);
  if (process.platform === "linux") {
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      if (identity(fs.fstatSync(fd, { bigint: true })) !== expected || checkedDirectory(directory) !== expected)
        throw unavailable();
      const result = operation(`/proc/self/fd/${fd}/${path.basename(file)}`);
      if (checkedDirectory(directory) !== expected) throw unavailable();
      return result;
    } finally {
      fs.closeSync(fd);
    }
  }
  const result = operation(file);
  if (checkedDirectory(directory) !== expected) throw unavailable();
  return result;
}

export function regularFile(file: string, maxBytes = fileMax) {
  const s = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (s && (!s.isFile() || s.nlink !== 1n || s.size > BigInt(maxBytes) || !sameSpelling(realpath(file), file)))
    throw unavailable();
  return s;
}

export function openRegular(file: string, flags = fs.constants.O_RDONLY, maxBytes = fileMax) {
  const before = regularFile(file, maxBytes);
  if (!before) throw unavailable();
  const fd = fs.openSync(file, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!sameFile(fd, file, before, maxBytes)) throw unavailable();
    return { fd, before };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
export function sameFile(fd: number, file: string, before: fs.BigIntStats, maxBytes = fileMax) {
  const current = regularFile(file, maxBytes);
  return !!current && stamp(current) === stamp(before) && stamp(fs.fstatSync(fd, { bigint: true })) === stamp(before);
}

export function bytesAt(fd: number, offset: number, length: number) {
  const bytes = Buffer.allocUnsafe(length);
  for (let n = 0; n < length; ) {
    const got = fs.readSync(fd, bytes, n, length - n, offset + n);
    if (!got) throw unavailable();
    n += got;
  }
  return bytes;
}
export async function fingerprint(
  file: string,
  rel: string,
  active: () => void,
  maxBytes = fileMax,
): Promise<FolderRevision> {
  const { fd, before } = openRegular(file, fs.constants.O_RDONLY, maxBytes);
  try {
    const size = Number(before.size);
    let revision: FolderRevision;
    if (isOrganization(rel)) {
      const bytes = organizationBytes(fd, size);
      revision = { bytes: bytes.length, sha: digest(bytes) };
    } else {
      const hash = createHash("sha256"),
        block = Buffer.allocUnsafe(Math.min(chunkMax, size));
      let yieldAt = chunkMax * 16;
      for (let offset = 0; offset < size; ) {
        if (offset >= yieldAt) {
          yieldAt = offset + chunkMax * 16;
          await setImmediate();
          active();
        }
        const got = fs.readSync(fd, block, 0, Math.min(block.length, size - offset), offset);
        if (!got) throw unavailable();
        hash.update(block.subarray(0, got));
        offset += got;
      }
      revision = { bytes: size, sha: hash.digest("hex") };
    }
    if (!sameFile(fd, file, before, maxBytes)) throw unavailable();
    return revision;
  } finally {
    fs.closeSync(fd);
  }
}
export function organizationBytes(fd: number, size: number) {
  if (size > 2 * 1024 * 1024) throw unavailable();
  const data = cleanProjectDefinition(".apc/organization.json", bytesAt(fd, 0, size));
  if (!data) throw unavailable();
  return data;
}
/** La proyección compartida excluye anotaciones privadas; una actualización remota no debe descartarlas del original. */
export function preserveLocalOrganization(file: string) {
  const { fd, before } = openRegular(file);
  try {
    const size = Number(before.size);
    if (size > 2 * 1024 * 1024) throw unavailable();
    const raw = bytesAt(fd, 0, size);
    const clean = cleanProjectDefinition(".apc/organization.json", raw);
    if (!clean || !isDeepStrictEqual(JSON.parse(withoutBom(raw.toString("utf8"))), JSON.parse(clean.toString("utf8"))))
      throw new Error(
        "La organización del proyecto contiene campos locales adicionales. Consérvalos antes de sincronizar este cambio.",
      );
    if (!sameFile(fd, file, before)) throw unavailable();
  } finally {
    fs.closeSync(fd);
  }
}
export function conflictPath(rel: string, sha: string) {
  const base = path.posix.basename(rel);
  const extension = path.posix
    .extname(base)
    .slice(0, 16)
    .replace(/[^a-zA-Z0-9.]/g, "");
  const label = base
    .slice(0, base.length - path.posix.extname(base).length)
    .replace(/[^\p{L}\p{N}_-]/gu, "-")
    .slice(0, 45);
  return `Conflictos de Colonia/${label || "archivo"}-${digest(rel).slice(0, 20)}-${sha}${extension}`;
}
