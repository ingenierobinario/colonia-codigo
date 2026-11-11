// Starting with the computer. macOS and Windows have it in Electron; Linux desktops read an XDG autostart entry.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { loginCommand } from "./linux-desktop.ts";

/** Marks a start the person did not ask for: Colonia stays out of the way until they open it. */
export const HIDDEN_ARG = "--hidden";

/** What a Linux login starts: the AppImage itself when Colonia runs from one (its mount path changes every run). */
export function linuxEntry(exec: string, env: NodeJS.ProcessEnv = {}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Colonia",
    `Exec=${loginCommand(exec, env)} ${HIDDEN_ARG}`,
    `TryExec=${exec}`,
    "Icon=colonia",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Whether this start came from the login item rather than from the person. */
export function startedAtLogin(argv: readonly string[] = process.argv): boolean {
  if (argv.includes(HIDDEN_ARG)) return true;
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

export function setLaunchAtLogin(on: boolean): void {
  if (!app.isPackaged) return;
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: on, ...(process.platform === "win32" ? { args: [HIDDEN_ARG] } : {}) });
    return;
  }
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "colonia.desktop");
  try {
    if (on) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, linuxEntry(process.env.APPIMAGE || process.execPath, process.env));
    } else fs.rmSync(file, { force: true });
  } catch {
    // a read-only home: Colonia still runs, it just will not start by itself
  }
}
