import fs from "node:fs";
import path from "node:path";
import { isInside, realpath } from "../paths.ts";
import { checkedDirectory, inParent, openRegular, regularFile, sameFile } from "../sync/continuous-folder-disk.ts";

const reject = () => new Error("El archivo del adjunto no pertenece al almacén de medios de esta Colonia.");
export function mediaDirectory(dir: string, create: boolean) {
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })) {
    if (!create) throw reject();
    inParent(dir, (p) => fs.mkdirSync(p, { mode: 0o700 }));
  }
  return checkedDirectory(dir);
}
/** La ficha puede llegar antes de sus bytes. Incluso entonces se comprueban todos los padres que ya existen. */
export function mediaStoragePath(
  home: string,
  location: unknown,
  mode: "metadata" | "existing" | "create" = "metadata",
): string {
  if (typeof location !== "string" || !path.isAbsolute(location)) throw reject();
  const root = path.join(realpath(home), "media"),
    written = path.join(path.resolve(home), "media");
  const relative = path.relative(isInside(written, location) ? written : root, location),
    segments = relative.split(path.sep);
  if (
    path.isAbsolute(relative) ||
    segments.some(
      (p) =>
        !p ||
        p.startsWith(".") ||
        p.toLowerCase().endsWith(".sync-part") ||
        /[\p{Cc}<>:"\\|?*]/u.test(p) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(p),
    )
  )
    throw reject();
  const leaf = path.join(root, ...segments);
  let dir = root;
  for (let i = 0; i < segments.length; i++) {
    if (mode === "metadata" && !fs.lstatSync(dir, { throwIfNoEntry: false })) return leaf;
    mediaDirectory(dir, mode === "create");
    dir = path.join(dir, segments[i] as string);
  }
  if (mode === "metadata") regularFile(leaf, Number.MAX_SAFE_INTEGER);
  return leaf;
}
export function readMediaFile(home: string, file: string, size: number) {
  const location = mediaStoragePath(home, file, "existing"),
    max = Number.MAX_SAFE_INTEGER;
  const { fd, before } = openRegular(location, fs.constants.O_RDONLY, max);
  try {
    if (before.size !== BigInt(size)) throw reject();
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== size || !sameFile(fd, location, before, max)) throw reject();
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
