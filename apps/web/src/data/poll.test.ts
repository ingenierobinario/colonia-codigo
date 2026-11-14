import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "./createStore.ts";
import { keepSame, poll } from "./poll.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("PERF-3: una lectura idéntica conserva la referencia y el almacén no avisa a nadie", () => {
  // Dos cuentas del mismo tipo: lo que cambia en una no puede tapar a la otra.
  const read = (status: string) => [
    { id: "wa-1", type: "whatsapp", status: "running" },
    { id: "wa-2", type: "whatsapp", status },
  ];
  const store = createStore({ channels: read("running"), ready: false });
  let calls = 0;
  store.subscribe(() => calls++);
  const before = store.get().channels;
  for (let i = 0; i < 10; i++) store.set({ channels: keepSame(store.get().channels, read("running")), ready: true });
  assert.equal(calls, 1, "solo avisa la primera vez, por `ready`");
  assert.equal(store.get().channels, before);
  store.set({ channels: keepSame(store.get().channels, read("starting")), ready: true });
  assert.equal(calls, 2);
  assert.equal(store.get().channels[1]?.status, "starting");
  assert.equal(store.get().channels[0]?.status, "running");
});

test("PERF-3: el sondeo calla con la ventana oculta, no se apila y lee al volver a verse", async () => {
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  let runs = 0;
  let release: (() => void) | undefined;
  const stop = poll(
    () => {
      runs++;
      return new Promise<void>((r) => {
        release = r;
      });
    },
    10,
    doc as never,
  );
  assert.equal(runs, 1, "lee al montar");
  await wait(45);
  assert.equal(runs, 1, "la lectura sigue en camino: no se apila otra");
  release?.();
  await wait(30);
  assert.ok(runs >= 2);
  release?.();
  await wait(5);
  doc.hidden = true;
  const hiddenAt = runs;
  await wait(45);
  release?.();
  await wait(45);
  assert.ok(runs <= hiddenAt + 1, "oculta no pregunta (como mucho, la que ya estaba en el aire)");
  const quiet = runs;
  await wait(45);
  assert.equal(runs, quiet);
  doc.hidden = false;
  for (const fn of listeners) fn();
  assert.equal(runs, quiet + 1, "al volver a verse lee en el acto");
  stop();
  release?.();
  assert.equal(listeners.size, 0);
  const end = runs;
  await wait(40);
  assert.equal(runs, end, "parado no lee más");
});

test("PERF-3: un fallo de lectura no deja el sondeo atascado", async () => {
  let runs = 0;
  const stop = poll(() => Promise.reject(new Error(`sin core ${++runs}`)), 10, undefined);
  await wait(60);
  stop();
  assert.ok(runs >= 2);
});
