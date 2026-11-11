import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { failureMessage, fuseCommand, type LinuxHost, launchFailure, mountBlock, unpackedNote } from "./appimage.ts";
import type { ProcessRunner } from "./process.ts";

export type LinuxApp = {
  app: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  run: ProcessRunner;
  signal: AbortSignal;
};

const MIME = ["artifact", "app", "extension"].map((kind) => `application/x-colonia-${kind}`);
const MIME_PACKAGE = `<?xml version="1.0" encoding="utf-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
${[
  ["artifact", "coloniaart"],
  ["app", "coloniaapp"],
  ["extension", "coloniaext"],
]
  .map(
    ([kind, ext]) =>
      `  <mime-type type="application/x-colonia-${kind}">\n    <comment>Colonia document</comment>\n    <glob pattern="*.${ext}"/>\n    <generic-icon name="x-office-document"/>\n  </mime-type>`,
  )
  .join("\n")}
</mime-info>
`;

const dataHome = (o: Pick<LinuxApp, "env" | "userHome">) =>
  o.env.XDG_DATA_HOME || path.join(o.userHome, ".local", "share");

/** The menu entry. StartupWMClass is the window's class, so the dock groups the window under this icon. */
export function launcherEntry(app: string, icon: string, unpacked: boolean): string {
  const executable = app.replace(/%/g, "%%").replace(/[\\"`$]/g, "\\$&");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Colonia",
    "Comment=Your agents, your projects, one local core.",
    `Exec=${unpacked ? "env APPIMAGE_EXTRACT_AND_RUN=1 " : ""}"${executable}" %U`,
    `Icon=${icon}`,
    "Terminal=false",
    "Categories=Utility;",
    "StartupWMClass=Colonia",
    `MimeType=${MIME.join(";")};`,
    "",
  ].join("\n");
}

function firstPng(dir: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = firstPng(file);
      if (inner) return inner;
    } else if (entry.isFile() && entry.name.endsWith(".png")) return file;
  }
  return undefined;
}

/** The app's own icon, taken out of the AppImage (which needs no FUSE for that). Undefined when it cannot be had. */
async function appIcon(o: LinuxApp): Promise<string | undefined> {
  const icon = path.join(dataHome(o), "icons", "hicolor", "512x512", "apps", "colonia.png");
  try {
    if (fs.statSync(icon).mtimeMs >= fs.statSync(o.app).mtimeMs) return icon;
  } catch {
    // Not extracted yet.
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-icon-"));
  try {
    await o.run(o.app, ["--appimage-extract", "usr/share/icons/hicolor/*/apps/*.png"], {
      signal: o.signal,
      env: o.env,
      cwd: work,
    });
    const found = firstPng(work);
    if (!found) return undefined;
    fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.copyFileSync(found, icon);
    return icon;
  } catch {
    o.signal.throwIfAborted();
    return undefined;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Writes the menu entry, the icon and the file types Colonia opens. Only the entry itself is required. */
export async function writeLauncher(o: LinuxApp, unpacked: boolean): Promise<void> {
  const data = dataHome(o);
  const applications = path.join(data, "applications");
  const entry = launcherEntry(o.app, (await appIcon(o)) ?? "applications-development", unpacked);
  const file = path.join(applications, "colonia.desktop");
  fs.mkdirSync(applications, { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === entry) return;
  fs.writeFileSync(file, entry);
  try {
    const packages = path.join(data, "mime", "packages");
    fs.mkdirSync(packages, { recursive: true });
    fs.writeFileSync(path.join(packages, "colonia.xml"), MIME_PACKAGE);
    await o.run("update-mime-database", [path.join(data, "mime")], { signal: o.signal, env: o.env });
    await o.run("update-desktop-database", [applications], { signal: o.signal, env: o.env });
  } catch {
    // The desktop tools are optional: without them the entry still shows, only file associations wait.
    o.signal.throwIfAborted();
  }
}

/**
 * Opens the AppImage and explains a start that fails. An AppImage that cannot mount itself runs unpacked instead;
 * nothing here ever turns the sandbox off.
 */
export async function openLinuxDesktop(
  o: LinuxApp & { args: string[]; dataDir: string; host: LinuxHost; note?: ((text: string) => void) | undefined },
): Promise<void> {
  const block = mountBlock(o.host, o.app, o.env);
  const command = block && fuseCommand(o.host.read("/etc/os-release"), block);
  let unpacked = Boolean(block);
  const log = path.join(o.dataDir, "launch-error.log");
  const attempt = async (): Promise<string | undefined> => {
    const options = {
      signal: o.signal,
      detached: true,
      env: unpacked ? { ...o.env, APPIMAGE_EXTRACT_AND_RUN: "1" } : o.env,
      // Unpacking takes seconds, and only then can the app fail.
      ...(unpacked ? { settle: 12_000 } : {}),
    };
    try {
      await o.run(o.app, o.args, options);
      return undefined;
    } catch {
      o.signal.throwIfAborted();
    }
    // Once more with its words kept: the first run had nowhere to say why.
    fs.mkdirSync(o.dataDir, { recursive: true });
    try {
      await o.run(o.app, o.args, { ...options, output: log });
      return undefined;
    } catch (error) {
      o.signal.throwIfAborted();
      const said = o.host.read(log)?.slice(-4000).trim();
      return said || (error instanceof Error ? error.message : String(error));
    }
  };
  await writeLauncher(o, unpacked);
  let failed = await attempt();
  if (failed && !unpacked && launchFailure(failed) === "mount") {
    unpacked = true;
    await writeLauncher(o, true);
    failed = await attempt();
  }
  if (failed) throw new Error(failureMessage(failed, command || fuseCommand(o.host.read("/etc/os-release"), ALL)));
  if (unpacked) o.note?.(unpackedNote(command));
}

const ALL = { device: false, helper: true, library: true };
