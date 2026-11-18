import fs from "node:fs";
import path from "node:path";
import { isInside, realpath, samePath } from "../paths.ts";
import { ArchiveError } from "./archive.ts";

const bad = () => new ArchiveError("broken");
export function reserveFolder(parent: string, prefix: string): string {
  const created = fs.mkdtempSync(path.toNamespacedPath(path.join(parent, prefix)));
  return path.join(realpath(parent), path.basename(created));
}
export function fileTarget(root: string, rel: string) {
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
export const writeAll = (fd: number, bytes: Buffer) => {
  for (let n = 0; n < bytes.length; ) {
    const written = fs.writeSync(fd, bytes, n, bytes.length - n);
    if (!written) throw bad();
    n += written;
  }
};
export function publishArchive(part: string, file: string) {
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
}
