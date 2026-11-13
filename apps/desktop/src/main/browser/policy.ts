// CHROME-1: what a tab does like any browser, decided without touching Electron so it can be tested: its keyboard
// shortcuts, its zoom steps, which permissions a page gets, and where a download is saved.
import path from "node:path";

export type TabAction =
  | "find"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "print"
  | "reload"
  | "stop"
  | "back"
  | "forward"
  | "devtools";

export const TAB_ACTIONS: readonly TabAction[] = [
  "find",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
  "print",
  "reload",
  "stop",
  "back",
  "forward",
  "devtools",
];

type Key = { key: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };

/** The browser shortcut a key press is, if any. Cmd on macOS, Ctrl elsewhere. */
export function shortcut(input: Key, mac: boolean): TabAction | undefined {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const mod = mac ? Boolean(input.meta) && !input.control : Boolean(input.control) && !input.meta;
  if (!mod) {
    if (input.control || input.meta) return undefined;
    if (key === "F5" && !input.alt) return "reload";
    if (key === "F12" && !input.alt) return "devtools";
    // Alt+arrows go back and forward outside macOS (there they move by word in a text field).
    if (!mac && input.alt && !input.shift && key === "ArrowLeft") return "back";
    if (!mac && input.alt && !input.shift && key === "ArrowRight") return "forward";
    return undefined;
  }
  // The developer tools: Ctrl+Shift+I, or Cmd+Option+I on macOS.
  if (key === "i" && (mac ? input.alt && !input.shift : input.shift && !input.alt)) return "devtools";
  // AltGr reaches us as Ctrl+Alt on Windows: those are characters (@, €, [), never shortcuts.
  if (input.alt) return undefined;
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  if (input.shift) return undefined;
  if (key === "f") return "find";
  if (key === "0") return "zoom-reset";
  if (key === "p") return "print";
  if (key === "r") return "reload";
  if (mac && key === "[") return "back";
  if (mac && key === "]") return "forward";
  return undefined;
}

/** Chrome's own zoom steps. */
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** The zoom factor after one step in or out, or back to 100 %. */
export function nextZoom(factor: number, action: "zoom-in" | "zoom-out" | "zoom-reset"): number {
  if (action === "zoom-reset") return 1;
  if (action === "zoom-in") return ZOOMS.find((z) => z > factor + 0.005) ?? ZOOMS[ZOOMS.length - 1] ?? 5;
  return ZOOMS.findLast((z) => z < factor - 0.005) ?? ZOOMS[0] ?? 0.25;
}

/**
 * What a page gets when it asks. Fullscreen, pointer lock and writing to the clipboard are what any page does on a
 * click (a video player, a "Copy" button) and never leave the page; a device or the owner's attention is asked for;
 * the rest is refused.
 */
export function permissionPolicy(permission: string): "allow" | "ask" | "deny" {
  if (permission === "fullscreen" || permission === "pointerLock" || permission === "clipboard-sanitized-write")
    return "allow";
  if (
    permission === "media" ||
    permission === "geolocation" ||
    permission === "notifications" ||
    permission === "clipboard-read"
  )
    return "ask";
  return "deny";
}

/** The question the owner is asked when a page wants a device or their attention. */
export function permissionQuestion(
  permission: string,
  media: readonly string[],
  origin: string,
  spanish: boolean,
): { message: string; detail: string; buttons: [string, string] } {
  const mic = media.includes("audio");
  const cam = media.includes("video");
  const what = spanish
    ? permission === "media"
      ? cam && mic
        ? "usar tu cámara y tu micrófono"
        : cam
          ? "usar tu cámara"
          : "usar tu micrófono"
      : permission === "geolocation"
        ? "saber dónde estás"
        : permission === "notifications"
          ? "enviarte avisos"
          : "leer lo que tienes copiado"
    : permission === "media"
      ? cam && mic
        ? "use your camera and microphone"
        : cam
          ? "use your camera"
          : "use your microphone"
      : permission === "geolocation"
        ? "know your location"
        : permission === "notifications"
          ? "send you notifications"
          : "read what you have copied";
  let site = origin;
  try {
    site = new URL(origin).host;
  } catch {}
  return spanish
    ? {
        message: `${site} quiere ${what}`,
        detail: "Si lo permites, vale para este sitio hasta que cierres Colonia.",
        buttons: ["Permitir", "Bloquear"],
      }
    : {
        message: `${site} wants to ${what}`,
        detail: "If you allow it, it holds for this site until you quit Colonia.",
        buttons: ["Allow", "Block"],
      };
}

/** The origin a permission is remembered for, or undefined when the address has none. */
export function originOf(url: string | undefined): string | undefined {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** A file name for the downloads folder: the page's own, without a path, and never over a file already there. */
export function downloadPath(dir: string, suggested: string, exists: (file: string) => boolean): string {
  const cleaned = path
    .basename(suggested.replaceAll("\\", "/"))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what must go
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const name = cleaned || "download";
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let file = path.join(dir, name);
  for (let n = 1; exists(file) && n < 10_000; n++) file = path.join(dir, `${stem} (${n})${ext}`);
  return file;
}

const RUNNABLE = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".lnk",
  ".reg",
  ".jar",
  ".sh",
  ".command",
  ".app",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".appimage",
  ".desktop",
  ".hta",
  ".cpl",
  ".msc",
]); // prettier-ignore

/** Whether a finished download may be opened from Colonia's notice; a program is only shown in its folder. */
export function opensDirectly(file: string): boolean {
  return !RUNNABLE.has(path.extname(file).toLowerCase());
}
