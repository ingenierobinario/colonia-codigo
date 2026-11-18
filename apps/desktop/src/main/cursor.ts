import path from "node:path";
import type { ComputerActor } from "@colonia/protocol";
import { BrowserWindow, screen } from "electron";
import { BLOB_NAMES, type BlobName } from "../../../../packages/ui/src/blobs/catalog.ts";
import { hashSeed } from "../../../../packages/ui/src/blobs/seed.ts";

export type AgentCursor = ReturnType<typeof createCursor>;

export function createCursor() {
  let win: BrowserWindow | undefined;
  let display: number | undefined;
  let ready: Promise<void> | undefined;
  let revision = 0;
  /** Where the pointer was last put (screen points), so a note can show there. */
  let at: { x: number; y: number } | undefined;

  async function onScreenOf(x: number, y: number, stamp: number) {
    const d = screen.getDisplayNearestPoint({ x, y });
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        ...d.bounds,
        transparent: true,
        frame: false,
        // Al mostrar una ventana sin marco, AppKit permite este origen incluso sobre la barra de menús.
        enableLargerThanScreen: true,
        focusable: false,
        hasShadow: false,
        resizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, "screen-saver");
      win.setBounds(d.bounds);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // Out of every screen picture: the agent must not see its own pointer.
      win.setContentProtection(true);
      ready = win.loadFile(path.join(import.meta.dirname, "cursor.html"));
      display = d.id;
    } else if (display !== d.id) {
      win.setBounds(d.bounds);
      display = d.id;
    }
    const window = win;
    await ready;
    if (stamp !== revision || window.isDestroyed()) return;
    // Above every window, every time: an app brought forward must not cover it.
    win.setAlwaysOnTop(true, "screen-saver");

    // From where the window really is: macOS may keep it off the menu bar, and the pointer must land on the point.
    const at = win.getBounds();
    return { w: window, lx: x - at.x, ly: y - at.y };
  }

  // VENTANA-DESTRUIDA-1: al salir Electron cierra la ventana del cursor antes de que el uso del ordenador pare.
  const live = () => (win && !win.isDestroyed() ? win : undefined);
  const run = (js: string) =>
    live()
      ?.webContents.executeJavaScript(js)
      .catch(() => {});

  async function draw(x: number, y: number, note: string, actor?: ComputerActor) {
    const stamp = ++revision;
    const point = await onScreenOf(x, y, stamp);
    if (!point || stamp !== revision) return;
    const blob = actor && (actor.blob ?? BLOB_NAMES[hashSeed(actor.id) % BLOB_NAMES.length]);
    const face = blob && BLOB_NAMES.includes(blob as BlobName) ? blob : undefined;
    const args = [Math.round(point.lx), Math.round(point.ly), note, actor && { name: actor.name }, face];
    await point.w.webContents.executeJavaScript(`drawCursor(...${JSON.stringify(args)})`);
    if (stamp === revision && !point.w.isDestroyed()) point.w.showInactive();
  }

  return {
    async moveTo(x: number, y: number, note: string, actor?: ComputerActor): Promise<void> {
      at = { x, y };
      await draw(x, y, note, actor);
      await new Promise((r) => setTimeout(r, 250));
    },
    pulse: () => void run("pulse()"),
    say(note: string, actor?: ComputerActor) {
      const d = screen.getPrimaryDisplay().bounds;
      const p = at ?? { x: d.x + d.width / 2, y: d.y + d.height / 2 };
      void draw(p.x, p.y, note, actor).catch(() => {});
    },
    hide() {
      revision++;
      at = undefined;
      live()?.hide();
    },
    close() {
      revision++;
      live()?.destroy();
    },
  };
}
