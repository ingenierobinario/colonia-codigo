import path from "node:path";

/**
 * Where the running Colonia.app is, as far as replacing it goes: a place this user can write (ok), the temporary
 * read-only copy macOS runs a just-downloaded app from (translocated), its disk image, another place this user cannot
 * write, or not an app bundle at all.
 */
export type BundlePlace = "ok" | "translocated" | "disk-image" | "read-only" | "none";

const bundleOf = (execPath: string) => path.posix.resolve(path.posix.dirname(execPath), "..", "..");

export function bundlePlace(execPath: string, canWrite: (dir: string) => boolean): BundlePlace {
  const bundle = bundleOf(execPath);
  if (!bundle.endsWith(".app")) return "none";
  if (bundle.includes("/AppTranslocation/")) return "translocated";
  if (canWrite(path.posix.dirname(bundle)) && canWrite(bundle)) return "ok";
  // A disk image mounts read-only; a disk the owner can write is a place like any other.
  return bundle.startsWith("/Volumes/") ? "disk-image" : "read-only";
}

/** The running Colonia.app, when macOS lets this user replace it (not a disk image, not a translocated copy). */
export function replaceableBundle(execPath: string, canWrite: (dir: string) => boolean): string | undefined {
  return bundlePlace(execPath, canWrite) === "ok" ? bundleOf(execPath) : undefined;
}

const REFUSED = new Set(["EPERM", "EACCES", "EROFS"]);

/**
 * Saves `name` in the first of `dirs` the system lets this app write, and says where: macOS can keep an app out of
 * Downloads (Privacy & Security › Files and Folders), and the installer is as good from anywhere else.
 */
export async function saveInFirst(
  dirs: string[],
  name: string,
  save: (file: string) => Promise<void>,
): Promise<string> {
  let refused: unknown;
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      await save(file);
      return file;
    } catch (err) {
      if (!REFUSED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
      refused = err;
    }
  }
  throw refused ?? new Error("nowhere to save");
}
