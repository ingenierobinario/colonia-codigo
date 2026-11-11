// Why the core found no browser it can drive, in words the owner can act on.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FLATPAKS = ["com.google.Chrome", "org.chromium.Chromium", "com.microsoft.Edge", "com.brave.Browser"];

/**
 * A Flatpak browser is there but cannot be used: its sandbox passes on neither the pipe it is driven over nor a profile
 * folder outside its own, so it is named as the reason instead of being started to time out.
 */
export function browserMissing(
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
  exists: (file: string) => boolean = fs.existsSync,
): string {
  const none = "no Chrome, Chromium or Edge on this machine";
  if (platform !== "linux") return none;
  const exports = ["/var/lib/flatpak/exports/bin", path.posix.join(home, ".local/share/flatpak/exports/bin")];
  const flatpak = exports.some((dir) => FLATPAKS.some((id) => exists(path.posix.join(dir, id))));
  return flatpak
    ? "the browser on this machine is a Flatpak, which Colonia cannot drive from outside its sandbox. Install Chrome or Chromium from your distribution's packages (or the package from google.com/chrome), or set COLONIA_CHROME to one"
    : `${none}. Install one (for example: sudo apt install chromium), or set COLONIA_CHROME to its path`;
}
