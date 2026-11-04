import { client } from "../data/client.ts";

/** Applies the desktop settings in the shell (no-op in a plain browser). Kept apart so the shell loads without Config. */
export async function applyDesktopPrefs(): Promise<void> {
  if (!window.coloniaDesktop?.applyDesktopPrefs) return;
  try {
    const p = await client.call("desktop.get", {});
    window.coloniaDesktop.applyDesktopPrefs({
      shortcut: p.shortcut,
      launchAtLogin: p.launch_at_login,
      computerUse: p.computer_use,
    });
  } catch {}
}

/** Computer use runs in the desktop app on macOS and Windows. */
export const computerUseHere = () => ["darwin", "win32"].includes(window.coloniaDesktop?.platform ?? "");

/** The emergency stop's keys on this computer (Ctrl+Shift+Esc is Windows' Task Manager). */
export const stopKeys = () => (window.coloniaDesktop?.platform === "win32" ? "Ctrl+Alt+Esc" : "⌘⇧Esc");
