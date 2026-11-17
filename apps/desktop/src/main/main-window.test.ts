// VENTANA-DESTRUIDA-1: un Electron de mentira que se queja como el de verdad («Object has been destroyed») si alguien
// toca la ventana después de destruirla. Reproduce la salida en Windows: la ventana ya se cerró y, mientras la app
// espera al núcleo, la bandeja, otra instancia o el Dock piden abrirla.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { liveWindow, mainOpener, whileWindowLives } from "./main-window.ts";

class FakeWindow extends EventEmitter {
  destroyed = false;
  minimized = false;
  used: string[] = [];
  #use(what: string) {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    this.used.push(what);
  }
  isDestroyed = () => this.destroyed;
  isMinimized = () => (this.#use("isMinimized"), this.minimized);
  restore = () => this.#use("restore");
  show = () => this.#use("show");
  moveTop = () => this.#use("moveTop");
  focus = () => this.#use("focus");
  close() {
    this.destroyed = true;
    this.emit("closed");
  }
}

test("VENTANA-DESTRUIDA-1: openMain sobre la ventana viva la trae al frente", () => {
  const win = new FakeWindow();
  let before = 0;
  mainOpener(win, () => before++).open();
  assert.deepEqual(win.used, ["isMinimized", "show", "moveTop", "focus"]);
  assert.equal(before, 1);
});

test("VENTANA-DESTRUIDA-1: openMain sobre la ventana destruida no lanza ni hace nada", () => {
  const win = new FakeWindow();
  const { open, foreground } = mainOpener(win);
  win.close();
  assert.doesNotThrow(open);
  assert.doesNotThrow(foreground);
  assert.deepEqual(win.used, []);
});

test("VENTANA-DESTRUIDA-1: el 'restore' pendiente que llega con la ventana destruida no la toca", () => {
  const win = new FakeWindow();
  win.minimized = true;
  mainOpener(win).open();
  win.destroyed = true;
  assert.doesNotThrow(() => win.emit("restore"));
});

test("VENTANA-DESTRUIDA-1: second-instance y activate se desregistran al cerrarse la ventana", () => {
  const app = new EventEmitter();
  const win = new FakeWindow();
  const { open } = mainOpener(win);
  whileWindowLives(app, win, { activate: open, "second-instance": open });
  app.emit("second-instance");
  assert.equal(win.used.includes("show"), true);
  win.close();
  assert.equal(app.listenerCount("activate"), 0);
  assert.equal(app.listenerCount("second-instance"), 0);
  assert.doesNotThrow(() => app.emit("activate"));
});

test("VENTANA-DESTRUIDA-1: liveWindow solo devuelve una ventana viva", () => {
  const win = new FakeWindow();
  assert.equal(liveWindow(win), win);
  win.close();
  assert.equal(liveWindow(win), undefined);
  assert.equal(liveWindow(undefined), undefined);
});
