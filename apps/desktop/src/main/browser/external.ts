// Opens a page in the owner's own browsers (the system default, or one of the installed ones by name).
// Only http(s) leaves the app: the panel cannot hand the OS a file:, custom-scheme or javascript: URL.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";

export type InstalledBrowser = { id: string; name: string };
type Found = InstalledBrowser & { launch: string };

/** id · shown name · macOS app · Windows executable(s) (under Program Files / LocalAppData) · Linux commands. */
const KNOWN: Array<[string, string, string, string | string[], string[]]> = [
  [
    "chrome",
    "Google Chrome",
    "Google Chrome.app",
    "Google/Chrome/Application/chrome.exe",
    ["google-chrome", "google-chrome-stable"],
  ],
  ["safari", "Safari", "Safari.app", "", []],
  ["firefox", "Firefox", "Firefox.app", "Mozilla Firefox/firefox.exe", ["firefox"]],
  ["edge", "Microsoft Edge", "Microsoft Edge.app", "Microsoft/Edge/Application/msedge.exe", ["microsoft-edge"]],
  [
    "brave",
    "Brave",
    "Brave Browser.app",
    "BraveSoftware/Brave-Browser/Application/brave.exe",
    ["brave-browser", "brave"],
  ],
  ["arc", "Arc", "Arc.app", "", []],
  ["chromium", "Chromium", "Chromium.app", "Chromium/Application/chrome.exe", ["chromium", "chromium-browser"]],
  ["vivaldi", "Vivaldi", "Vivaldi.app", "Vivaldi/Application/vivaldi.exe", ["vivaldi", "vivaldi-stable"]],
  // INSTALAR-NAV-1: Opera installs for one user under LocalAppData/Programs unless told otherwise.
  ["opera", "Opera", "Opera.app", ["Opera/opera.exe", "Programs/Opera/opera.exe"], ["opera"]],
  ["zen", "Zen", "Zen.app", "", ["zen-browser"]],
];

function locate(app: string, exe: string | string[], commands: string[]): string | undefined {
  if (process.platform === "darwin") {
    if (!app) return undefined;
    return [path.join("/Applications", app), path.join(os.homedir(), "Applications", app)].find((p) =>
      fs.existsSync(p),
    );
  }
  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
    const exes = [exe].flat().filter(Boolean);
    return roots
      .filter(Boolean)
      .flatMap((r) => exes.map((x) => path.join(r as string, x)))
      .find((p) => fs.existsSync(p));
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const cmd of commands) {
    const hit = dirs.map((d) => path.join(d, cmd)).find((p) => fs.existsSync(p));
    if (hit) return hit;
  }
  return undefined;
}

let cache: Found[] | undefined;

/** The browsers this computer has, looked up once per run; `fresh` looks again (INSTALAR-NAV-1: after installing one). */
export function installedBrowsers(fresh = false): Found[] {
  if (fresh) cache = undefined;
  cache ??= KNOWN.flatMap(([id, name, app, exe, commands]) => {
    const launch = locate(app, exe, commands);
    return launch ? [{ id, name, launch }] : [];
  });
  return cache;
}

export function isWebUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** `browser` undefined = the system default. An unknown id or a non-web URL does nothing. */
export async function openExternal(url: unknown, browser?: unknown): Promise<boolean> {
  if (!isWebUrl(url)) return false;
  if (browser == null) {
    await shell.openExternal(url);
    return true;
  }
  const found = installedBrowsers().find((b) => b.id === browser);
  if (!found) return false;
  if (process.platform === "darwin") {
    execFile("open", ["-a", found.launch, url], { windowsHide: true }, () => {});
  } else {
    // A browser window the owner must see: hiding would hide its first window too.
    const child = spawn(found.launch, [url], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => {});
    child.unref();
  }
  return true;
}
