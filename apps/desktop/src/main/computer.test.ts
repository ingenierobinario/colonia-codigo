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
    getAllDisplays: () => [display],
    getDisplayMatching: () => display,
  },
  desktopCapturer: { getSources: async () => [{ display_id: "1", thumbnail: image }] },
  shell: {},
  systemPreferences: {},
  app: {},
  BrowserWindow: class {},
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
  const cursor = { say() {}, moveTo: async () => {}, pulse() {}, hide() {} } as unknown as AgentCursor;
  const computer = createComputer({
    cursor,
    driver,
    onActivity: (a) => activity.push(a),
    onStopped: (s) => stopped.push(s),
  });
  return { computer, calls, activity, stopped };
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
