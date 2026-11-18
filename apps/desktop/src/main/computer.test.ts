// DETENER-VIVO-1: the emergency stop against an action that is already on its way.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { ComputerActivity } from "./computer.ts";
import type { ComputerDriver, Front } from "./computer-driver.ts";
import type { AgentCursor } from "./cursor.ts";

const display = {
  id: 1,
  size: { width: 1000, height: 800 },
  scaleFactor: 1,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
};
const image = {
  isEmpty: () => false,
  getSize: () => ({ width: 1000, height: 800 }),
  crop: () => image,
  resize: () => image,
  toJPEG: () => Buffer.from("jpeg"),
};
const native = {
  screen: {
    getPrimaryDisplay: () => display,
    getDisplayNearestPoint: () => display,
    getAllDisplays: () => [display],
    getDisplayMatching: () => display,
  },
  desktopCapturer: { getSources: async () => [{ display_id: "1", thumbnail: image }] },
  shell: {},
  systemPreferences: {},
  app: {},
  BrowserWindow: class {
    static loaded = gate<void>();
    static moves: string[] = [];
    static shows = 0;
    webContents = {
      executeJavaScript: async (js: string) => {
        native.BrowserWindow.moves.push(js);
      },
    };
    loadFile = (): Promise<void> => native.BrowserWindow.loaded.done;
    getBounds = () => display.bounds;
    isDestroyed = () => false;
    setIgnoreMouseEvents() {}
    setAlwaysOnTop() {}
    setBounds() {}
    setVisibleOnAllWorkspaces() {}
    setContentProtection() {}
    hide() {}
    showInactive() {
      native.BrowserWindow.shows++;
    }
  },
};
const boundary = Symbol.for("colonia.test.computer");
Object.assign(globalThis, { [boundary]: native });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("colonia.test.computer")]; export const screen = n.screen; export const desktopCapturer = n.desktopCapturer; export const shell = n.shell; export const systemPreferences = n.systemPreferences; export const app = n.app; export const BrowserWindow = n.BrowserWindow;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createComputer } = await import("./computer.ts");
const { createCursor } = await import("./cursor.ts");
hooks.deregister();

const CALC: Front = {
  app: "calc",
  pid: 7,
  window: "Calculator",
  bounds: { x: 10, y: 10, width: 400, height: 300 },
  lines: [],
};

/** A promise the test settles when it wants: the moment a slow step of the driver ends. */
function gate<T>() {
  let open!: (v: T) => void;
  const done = new Promise<T>((r) => {
    open = r;
  });
  return { done, open };
}

function harness(over: Partial<ComputerDriver> = {}) {
  const calls: string[] = [];
  const activity: ComputerActivity[] = [];
  const stopped: boolean[] = [];
  const driver: ComputerDriver = {
    front: async () => {
      calls.push("front");
      return CALC;
    },
    activate: async () => {
      calls.push("activate");
    },
    topAt: async () => undefined,
    open: async () => {
      calls.push("open");
    },
    canPress: () => true,
    key: async (app) => {
      calls.push("key");
      return app;
    },
    press: async () => {
      calls.push("press");
      return "pressed";
    },
    click: async () => {
      calls.push("click");
    },
    insert: async () => {
      calls.push("insert");
      return true;
    },
    paste: async () => {
      calls.push("paste");
    },
    ...over,
  };
  const presentadas: unknown[] = [];
  const cursor = {
    say(_s: string, actor: unknown) {
      presentadas.push(actor);
    },
    moveTo: async (_x: number, _y: number, _s: string, actor: unknown) => {
      presentadas.push(actor);
    },
    pulse() {},
    hide() {},
  } as unknown as AgentCursor;
  const computer = createComputer({
    cursor,
    driver,
    onActivity: (a) => {
      if (a) activity.push(a);
    },
    onStopped: (s) => stopped.push(s),
  });
  return { computer, calls, activity, stopped, presentadas };
}

const STOP = /emergency stop/;

test("DETENER-VIVO-1: the stop pulled while an app opens drops that action: no wait for its window, no activity", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const opening = gate<void>();
  const h = harness({ open: () => opening.done });
  const call = h.computer.handle("computer.open", { app: "calc" });
  h.computer.stop();
  opening.open();
  await assert.rejects(call, STOP);
  assert.deepEqual(h.calls, [], "it did not go on to look for the window");
  assert.deepEqual(h.activity, [], "the live view is not told of an action the owner stopped");
  assert.deepEqual(h.stopped, [true]);
});

test("DETENER-VIVO-1: an action that started before the stop is dropped even after the hold is over", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const inserting = gate<boolean>();
  const h = harness({ insert: () => inserting.done });
  const call = h.computer.handle("computer.type", { app: "calc", text: "1+1" });
  h.computer.stop();
  t.mock.timers.tick(3_000);
  assert.deepEqual(h.stopped, [true, false], "the hold is over");
  inserting.open(false);
  await assert.rejects(call, STOP);
  assert.deepEqual(h.calls, [], "nothing was pasted into the owner's app");
  assert.deepEqual(h.activity, []);
  // The stop is for that time only: the next request works as usual.
  assert.deepEqual(await h.computer.handle("computer.key", { app: "calc", keys: "enter" }), { app: "calc" });
  assert.deepEqual(h.calls, ["activate", "key"]);
});

test("DETENER-VIVO-1: the stop pulled while a click finds nothing to press: no real click follows", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pressing = gate<string>();
  const h = harness({ press: () => pressing.done });
  const call = h.computer.handle("computer.click", { app: "calc", x: 20, y: 20 });
  // The pointer's glide is over and the press is on its way.
  await new Promise((r) => setImmediate(r));
  h.computer.stop();
  pressing.open("none: nothing there");
  await assert.rejects(call, STOP);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.activity, []);
});

test("DETENER-VIVO-1: after the stop the live view has no window to follow, until the agent's next action", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  await h.computer.handle("computer.open", { app: "calc" });
  assert.equal((await h.computer.frame())?.window, "Calculator");
  h.computer.stop();
  assert.equal(await h.computer.frame(), undefined);
  t.mock.timers.tick(3_000);
  assert.equal(await h.computer.frame(), undefined, "still none once the hold is over");
  await h.computer.handle("computer.open", { app: "calc" });
  assert.equal((await h.computer.frame())?.app, "calc");
});

test("CURSOR-FIABLE-1: en vivo el clic es real y el puntero se queda; nada se pulsa por accesibilidad", async () => {
  const stays: (boolean | undefined)[] = [];
  const h = harness({
    click: async (_a, _x, _y, stay) => {
      stays.push(stay);
    },
  });
  const r = (await h.computer.handle("computer.click", { app: "calc", x: 20, y: 20, mode: "live" })) as { how: string };
  assert.deepEqual(h.calls, ["activate"], "ni press ni otra cosa: solo el clic real");
  assert.deepEqual(stays, [true]);
  assert.match(r.how, /real click/);
});

test("CURSOR-FIABLE-1: en segundo plano nunca hay clic real: si nada admite la pulsación, falla y lo dice", async () => {
  const none = harness({ press: async () => "none: nothing there" });
  await assert.rejects(
    none.computer.handle("computer.click", { app: "calc", x: 20, y: 20, mode: "background" }),
    /chose the background: nothing was clicked/,
  );
  assert.deepEqual(none.calls, [], "el puntero de la persona no se tocó");
  const ok = harness();
  assert.deepEqual(await ok.computer.handle("computer.click", { app: "calc", x: 20, y: 20, mode: "background" }), {
    app: "calc",
    how: "pressed",
  });
  assert.deepEqual(ok.calls, ["press"]);
});

test("CURSOR-FIABLE-1: la captura lleva la zona que muestra de verdad, no la de la ventana que se sale", async () => {
  // Ventana maximizada al estilo de Windows: sobresale 8 puntos por arriba y por la izquierda.
  const h = harness({ front: async () => ({ ...CALC, bounds: { x: -8, y: -8, width: 400, height: 300 } }) });
  const r = (await h.computer.handle("computer.snapshot", {})) as {
    map: { x: number; y: number; width: number; height: number; px_width: number; px_height: number };
    elements: string;
  };
  assert.equal(r.map.x, 0);
  assert.equal(r.map.y, 0);
  assert.equal(r.map.width, 392);
  assert.equal(r.map.height, 292);
  assert.doesNotMatch(r.elements, /px\*/, "ya no se le da una fórmula al modelo");
});

test("el puntero y la actividad siguen al agente actuante durante un relevo", async () => {
  const lenta = gate<boolean>();
  const h = harness({ insert: () => lenta.done });
  const primera = { id: "uno", name: "Alba", blob: "menta" };
  const segunda = { id: "dos", name: "Sol", blob: "coral" };
  const anterior = h.computer.handle("computer.type", { app: "calc", text: "1", actor: primera });
  await h.computer.handle("computer.click", { app: "calc", x: 40, y: 50, actor: segunda });
  lenta.open(true);
  await anterior;
  assert.deepEqual(h.presentadas, [primera, segunda]);
  assert.deepEqual(
    h.activity.map((a) => a.actor),
    [segunda],
    "la respuesta tardía no recupera el puntero",
  );
  await h.computer.handle("computer.key", { app: "calc", keys: "enter" });
  assert.equal(h.presentadas.at(-1), undefined);
  assert.equal(h.activity.at(-1)?.actor, undefined);
});

test("una captura que termina después del relevo no se presenta como la del nuevo agente", async (t) => {
  const taking = gate<void>();
  const resume = gate<void>();
  t.mock.method(native.desktopCapturer, "getSources", async () => {
    taking.open();
    await resume.done;
    return [{ display_id: "1", thumbnail: image }];
  });
  const h = harness();
  await h.computer.handle("computer.open", { app: "calc", actor: { id: "uno", name: "Alba" } });
  const pending = h.computer.frame();
  await taking.done;
  await h.computer.handle("computer.key", { app: "calc", keys: "enter", actor: { id: "dos", name: "Sol" } });
  resume.open();
  assert.equal(await pending, undefined);
  const current = await h.computer.frame();
  assert.ok(current);
  assert.equal(current.action, h.activity.at(-1)?.action);
});

test("detener o desconectar mientras se carga el puntero no vuelve a mostrar la ventana antigua", async () => {
  const cursor = createCursor();
  cursor.say("Primera tarea", { id: "uno", name: "Alba", blob: "menta" });
  cursor.hide();
  native.BrowserWindow.loaded.open();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(native.BrowserWindow.moves, []);
  assert.equal(native.BrowserWindow.shows, 0);
  cursor.say("Segunda tarea", { id: "dos", name: "Sol", blob: "coral" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(native.BrowserWindow.shows, 1);
  assert.match(native.BrowserWindow.moves[0] ?? "", /Sol/);
  assert.doesNotMatch(native.BrowserWindow.moves[0] ?? "", /Alba/);
});

test("perder el enlace retira también una acción pendiente y permite la siguiente conexión", async () => {
  const slow = gate<boolean>();
  const h = harness({ insert: () => slow.done });
  const pending = h.computer.handle("computer.type", { app: "calc", text: "1", actor: { id: "uno", name: "Alba" } });
  h.computer.disconnect();
  slow.open(true);
  await assert.rejects(pending, STOP);
  assert.deepEqual(h.activity, []);
  assert.equal(await h.computer.frame(), undefined);
  await h.computer.handle("computer.key", { app: "calc", keys: "enter", actor: { id: "dos", name: "Sol" } });
  assert.equal(h.activity.at(-1)?.actor?.id, "dos");
});

test("las teclas del mismo agente en la misma ventana comparten las imágenes en vivo", async () => {
  const h = harness();
  const actor = { id: "uno", name: "Alba" };
  await h.computer.handle("computer.open", { app: "calc", actor });
  const seen = await h.computer.frame();
  assert.ok(seen);
  await h.computer.handle("computer.key", { app: "calc", keys: "enter", actor });
  assert.equal(h.activity.at(-1)?.action, seen.action);
  await h.computer.handle("computer.key", { app: "calc", keys: "enter", actor: { id: "dos", name: "Sol" } });
  assert.notEqual(h.activity.at(-1)?.action, seen.action);
});

test("abrir el navegador predeterminado no deja una captura de la aplicación anterior", async () => {
  const h = harness();
  const actor = { id: "uno", name: "Alba" };
  await h.computer.handle("computer.open", { app: "calc", actor });
  assert.ok(await h.computer.frame());
  await h.computer.handle("computer.open", { url: "https://ejemplo.test/documento", actor });
  assert.equal(await h.computer.frame(), undefined);
});
