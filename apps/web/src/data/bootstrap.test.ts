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
const { loadProjectDirectory } = await import("./projects.ts");
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

function replies(t: TestContext, environment: () => Promise<unknown>, overrides: Record<string, () => unknown> = {}) {
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
    if (overrides[method]) return Response.json({ ok: true, result: await overrides[method]() });
    assert.ok(Object.hasOwn(values, method), method);
    return Response.json({ ok: true, result: values[method] });
  });
}

test("el directorio de proyectos llega al panel aunque la lista de agentes siga pendiente", async (t) => {
  const agents = Promise.withResolvers<unknown>();
  const answered = Promise.withResolvers<void>();
  const entry = { id: "p_directo", name: "Rutinas del proyecto" };
  replies(t, async () => status, {
    "agents.list": () => agents.promise,
    "projects.list": () => {
      answered.resolve();
      return { projects: [entry], base: { name: "General" } };
    },
  });
  const boot = bootstrap();
  try {
    await answered.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(data.get().projects[0]?.name, entry.name);
    assert.equal(data.get().base.name, "General");
    assert.equal(data.get().ready, false);
  } finally {
    agents.resolve({ agents: [] });
    await boot;
  }
});

test("una lectura de proyectos iniciada antes de una actualización no reemplaza el directorio actual", async (t) => {
  const first = Promise.withResolvers<unknown>();
  const entered = Promise.withResolvers<void>();
  let calls = 0;
  const row = (name: string) => ({ projects: [{ id: "p_vivo", name }], base: { name: "General" } });
  replies(t, async () => status, {
    "projects.list": () => {
      if (++calls === 1) {
        entered.resolve();
        return first.promise;
      }
      return row("Nombre actualizado");
    },
  });
  const older = bootstrap();
  try {
    await entered.promise;
    await bootstrap();
    assert.equal(data.get().projects[0]?.name, "Nombre actualizado");
  } finally {
    first.resolve(row("Nombre anterior"));
    await older;
  }
  assert.equal(data.get().projects[0]?.name, "Nombre actualizado");
});

test("las vistas comparten la consulta de directorio y una edición local sobrevive a su respuesta", async (t) => {
  const reply = Promise.withResolvers<unknown>();
  let calls = 0;
  replies(t, async () => status, {
    "projects.list": () => {
      calls++;
      return reply.promise;
    },
  });
  const first = loadProjectDirectory();
  assert.equal(loadProjectDirectory(), first);
  data.set({ base: { name: "Nombre elegido en este equipo" } });
  reply.resolve({ projects: [], base: { name: "Nombre anterior" } });
  await first;
  assert.equal(calls, 1);
  assert.equal(data.get().base.name, "Nombre elegido en este equipo");
});

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
