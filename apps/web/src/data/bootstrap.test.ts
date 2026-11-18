import assert from "node:assert/strict";
import { after, beforeEach, type TestContext, test } from "node:test";
import { waitFor } from "../../../core/src/testkit/platform.ts";
import { data } from "./state.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: Object.assign(new EventTarget(), { location: { origin: "http://panel.example.test" } }),
});
const { bootstrap, loadThreadWhenReady } = await import("./actions.ts");
after(() => {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else Reflect.deleteProperty(globalThis, "window");
});
const initial = data.get();
beforeEach(() => data.set(initial));
const status = { enabled: true, supported: true, chats: ["chat-equipo"], allowed: ["agente"], screens: [] };

test("cambiar de chat durante el arranque solo solicita el historial que sigue abierto, una vez", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const { thread } = JSON.parse(String(init.body));
    requests.push(thread);
    return Response.json({ ok: true, result: { thread: { id: thread }, messages: [], runs: [] } });
  });
  const leave = loadThreadWhenReady("anterior");
  leave?.();
  loadThreadWhenReady("actual");
  loadThreadWhenReady("actual");
  assert.deepEqual(requests, []);
  data.set({ ready: true });
  await waitFor(() => data.get().threadLoad.actual === "ready", "historial abierto");
  loadThreadWhenReady("actual");
  assert.deepEqual(requests, ["actual"]);
});

function replies(t: TestContext, environment: () => Promise<unknown>) {
  const values: Record<string, unknown> = {
    "agents.list": { agents: [] },
    "projects.list": { projects: [], base: "" },
    "threads.list": { threads: [] },
    "surfaces.list": { surfaces: [] },
    "browser.tabs": { tabs: [] },
    "jobs.list": [],
    "engines.status": { engines: [] },
    "models.list": { engines: [] },
    "models.config": {},
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const method = url.split("/").at(-1) ?? "";
    if (method === "environments.status") return Response.json({ ok: true, result: await environment() });
    assert.ok(Object.hasOwn(values, method), method);
    return Response.json({ ok: true, result: values[method] });
  });
}

test("la primera pantalla queda lista aunque el ordenador siga comprobándose", async (t) => {
  const pending = Promise.withResolvers<unknown>();
  replies(t, () => pending.promise);
  const boot = bootstrap();
  try {
    await waitFor(() => data.get().ready, "pantalla lista sin esperar al ordenador", { ms: 2000 });
    await boot;
    assert.deepEqual(data.get().vmThreads, []);
    pending.resolve(status);
    await waitFor(() => data.get().computers.supported, "estado del ordenador recibido");
    assert.deepEqual(data.get().vmThreads, ["chat-equipo"]);
    assert.deepEqual(data.get().computers.allowed, ["agente"]);
  } finally {
    pending.resolve(status);
    await boot;
  }
});

test("el estado tardío del arranque no borra una observación más reciente", async (t) => {
  const pending = Promise.withResolvers<unknown>();
  replies(t, () => pending.promise);
  const boot = bootstrap();
  const updated = { ...initial.computers, supported: true, allowed: ["otro-agente"] };
  try {
    await waitFor(() => data.get().ready, "pantalla lista", { ms: 2000 });
    data.set({ computers: updated, vmThreads: ["chat-reciente"] });
  } finally {
    pending.resolve(status);
    await boot;
    // La respuesta simulada y sus continuaciones se resuelven antes de la siguiente vuelta del bucle.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(data.get().computers, updated);
  assert.deepEqual(data.get().vmThreads, ["chat-reciente"]);
});
