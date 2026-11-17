// BANDEJA-DESTRUIDA-1 (9d5e95bc2): quick.ts de verdad, con un Electron de mentira que se queja como el de verdad
// («Tray is destroyed») si alguien toca la bandeja después de destruirla. Reproduce la salida: will-quit llama a stop()
// y el panel sigue mandando el contador de avisos, que llega a badge().
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

type Call = { what: string; destroyed: boolean };

function fakeElectron() {
  const calls: Call[] = [];
  const thrown: string[] = [];
  class Emitter {
    handlers = new Map<string, ((...a: unknown[]) => void)[]>();
    on(event: string, fn: (...a: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    off() {
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }
  }
  const windows: BrowserWindow[] = [];
  const trays: Tray[] = [];
  class Tray extends Emitter {
    #destroyed = false;
    constructor(_image: unknown) {
      super();
      trays.push(this);
      calls.push({ what: "new Tray", destroyed: false });
    }
    #use(what: string) {
      calls.push({ what, destroyed: this.#destroyed });
      if (this.#destroyed) {
        thrown.push(what);
        throw new TypeError("Object has been destroyed: Tray is destroyed");
      }
    }
    isDestroyed() {
      return this.#destroyed;
    }
    destroy() {
      this.#use("destroy");
      this.#destroyed = true;
    }
    setImage() {
      this.#use("setImage");
    }
    setTitle() {
      this.#use("setTitle");
    }
    setToolTip() {
      this.#use("setToolTip");
    }
    setContextMenu() {
      this.#use("setContextMenu");
    }
    getBounds() {
      this.#use("getBounds");
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    popUpContextMenu() {
      this.#use("popUpContextMenu");
    }
  }
  class BrowserWindow extends Emitter {
    destroyed = false;
    webContents = { isDevToolsOpened: () => false, getOSProcessId: () => 1 };
    constructor(_o: unknown) {
      super();
      windows.push(this);
    }
    isDestroyed = () => this.destroyed;
    #use(what: string) {
      if (this.destroyed) {
        thrown.push(`window.${what}`);
        throw new TypeError("Object has been destroyed");
      }
    }
    setVisibleOnAllWorkspaces() {}
    loadURL() {
      return Promise.resolve();
    }
    hide() {
      this.#use("hide");
    }
    isVisible() {
      this.#use("isVisible");
      return false;
    }
  }
  const image = { setTemplateImage() {} };
  return {
    calls,
    thrown,
    windows,
    trays,
    module: {
      app: { getLocale: () => "es-ES", dock: undefined, setLoginItemSettings() {}, getPath: () => os.tmpdir() },
      BrowserWindow,
      Tray,
      globalShortcut: { register: () => true, unregister() {}, unregisterAll() {} },
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromPath: () => image },
      nativeTheme: { shouldUseDarkColors: false, on() {}, off() {} },
      screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    },
  };
}

/** quick.ts tal y como está en el árbol (o en `QUICK_SRC`, para comprobar una versión anterior), con ese Electron. */
async function loadQuick(fake: ReturnType<typeof fakeElectron>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-quick-"));
  const out = path.join(dir, "quick.mjs");
  (globalThis as { __fakeElectron?: unknown }).__fakeElectron = fake.module;
  await build({
    entryPoints: [process.env.QUICK_SRC ?? path.join(import.meta.dirname, "quick.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [
      {
        name: "electron-falso",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "falso" }));
          b.onLoad({ filter: /.*/, namespace: "falso" }, () => ({
            contents: `const e = globalThis.__fakeElectron; export const { ${Object.keys(fake.module).join(", ")} } = e;`,
            loader: "js",
          }));
        },
      },
    ],
  });
  try {
    return (await import(pathToFileURL(out).href)) as typeof import("./quick.ts");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("BANDEJA-DESTRUIDA-1: el contador que llega después de stop() no toca la bandeja destruida", async () => {
  const fake = fakeElectron();
  const { createQuick } = await loadQuick(fake);
  const quick = createQuick({
    url: () => "http://127.0.0.1:1",
    preload: "",
    partition: "persist:quick",
    assets: os.tmpdir(),
    openMain: () => {},
  });
  quick.start();
  quick.badge(2);
  assert.ok(
    fake.calls.some((c) => c.what === "setImage" && !c.destroyed),
    "mientras vive, el contador la pinta",
  );
  // will-quit: stop(); y el panel aún manda avisos pendientes.
  quick.stop();
  assert.doesNotThrow(() => quick.badge(5));
  assert.doesNotThrow(() => quick.badge(0));
  // Un segundo stop (otra salida) tampoco.
  assert.doesNotThrow(() => quick.stop());
  assert.deepEqual(fake.thrown, [], `se tocó la bandeja destruida: ${fake.thrown.join(", ")}`);
});

test("VENTANA-DESTRUIDA-1: la bandeja que se pulsa con la ventana rápida ya cerrada (la app sale) no la toca", async () => {
  const fake = fakeElectron();
  const { createQuick } = await loadQuick(fake);
  let opened = 0;
  const quick = createQuick({
    url: () => "http://127.0.0.1:1",
    preload: "",
    partition: "persist:quick",
    assets: os.tmpdir(),
    openMain: () => opened++,
  });
  quick.start();
  // Al salir, Electron cierra todas las ventanas antes de will-quit (que es donde se para la bandeja).
  for (const w of fake.windows) w.destroyed = true;
  const tray = fake.trays[0];
  assert.ok(tray);
  assert.doesNotThrow(() => tray.emit("double-click"));
  assert.doesNotThrow(() => quick.hide());
  assert.equal(opened, 1, "pide abrir la principal (que ya sabe no tocar una ventana destruida)");
  assert.deepEqual(fake.thrown, [], `se tocó una ventana destruida: ${fake.thrown.join(", ")}`);
});
