import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { TabInfo } from "@colonia/protocol";
import { data } from "./state.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const { webAppTab } = await import("./webapps.ts");
after(() => {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else Reflect.deleteProperty(globalThis, "window");
});
beforeEach(() => data.set({ tabs: [] }));
const app = { id: "acme", name: "Acme", url: "https://example.com" };
const tab: TabInfo = { tab: "t1", url: app.url, title: app.name, profile: "app:acme", control: { kind: "idle" } };

test("dos aperturas simultáneas comparten una pestaña y conservan su estado más reciente", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const reply = Promise.withResolvers<Response>();
  const fetch = t.mock.method(globalThis, "fetch", async () => (await reply.promise).clone());
  const first = webAppTab(app);
  const second = webAppTab(app);
  const updated = { ...tab, url: "https://example.com/inicio", title: "Inicio" };
  data.set({ tabs: [updated] });
  reply.resolve(Response.json({ ok: true, result: tab }));
  assert.deepEqual(await Promise.all([first, second]), ["t1", "t1"]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(data.get().tabs, [updated]);
});

test("una apertura fallida permite reintentar y una pestaña existente se reutiliza", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    if (fail) throw new Error("Sin conexión");
    return Response.json({ ok: true, result: tab });
  });
  assert.equal(await webAppTab(app), undefined);
  fail = false;
  assert.equal(await webAppTab(app), "t1");
  assert.equal(await webAppTab(app), "t1");
  assert.equal(fetch.mock.callCount(), 2);
});
