// PROYECTO-COMPARTIR-1 · Lo que la persona pega se entiende como enlace o como paquete, mirar no guarda nada, y cada
// rechazo del core llega con su mensaje para quien no sabe qué es un paquete.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const share = await import("./project-share.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");

function mockRpc(t: TestContext, handlers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown>][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    const params = JSON.parse(String(init.body));
    calls.push([method, params]);
    assert.ok(Object.hasOwn(handlers, method), `unexpected RPC ${method}`);
    const result = handlers[method];
    if (result instanceof Error) throw result;
    return Response.json({ ok: true, result: typeof result === "function" ? await result(params) : result });
  });
  return calls;
}

const SUMMARY = { name: "Tienda", description: "", agents: 2, skills: 1, connections: 1, organization: true };

test("lo pegado: un enlace va como enlace, lo demás como paquete, y vacío no es nada", () => {
  assert.deepEqual(share.sourceOf("  https://mi.example.test/p/abc  "), { link: "https://mi.example.test/p/abc" });
  assert.deepEqual(share.sourceOf("colonia-proyecto-1:AAAA"), { content: "colonia-proyecto-1:AAAA" });
  assert.deepEqual(share.sourceOf('{"format":"colonia-proyecto-1"}'), { content: '{"format":"colonia-proyecto-1"}' });
  // Un enlace con texto alrededor no es un enlace: se trata como paquete y el core dirá que no lo es.
  assert.deepEqual(share.sourceOf("mira https://x.test/p/abc"), { content: "mira https://x.test/p/abc" });
  assert.equal(share.sourceOf("   "), undefined);
});

test("el nombre del fichero sale del proyecto, sin acentos ni signos", () => {
  assert.equal(share.packageFileName("Tienda de Ánimo ¡ya!"), "tienda-de-animo-ya.colonia.json");
  assert.equal(share.packageFileName("///"), "proyecto.colonia.json");
});

test("cada rechazo del core tiene su mensaje", () => {
  assert.equal(share.importErrorKey("this link is not a Colonia project link"), "pshare.err.link");
  assert.equal(share.importErrorKey("this file is not a Colonia project"), "pshare.err.foreign");
  assert.equal(share.importErrorKey("it was shared from a newer Colonia"), "pshare.err.newer");
  assert.equal(share.importErrorKey("the project is damaged: agents"), "pshare.err.damaged");
  assert.equal(share.importErrorKey('there is already a project named "Tienda"'), "pshare.err.taken");
  assert.equal(share.importErrorKey("the link did not answer"), "pshare.err.offline");
  assert.equal(share.importErrorKey("the project is too large to share"), "pshare.err.large");
  assert.equal(share.importErrorKey("boom"), "pshare.err.other");
});

test("mirar no guarda; importar guarda con lo que eligió la persona", async (t) => {
  const calls = mockRpc(t, {
    "projects.import": (p: { save: boolean; name?: string }) => ({
      ...SUMMARY,
      pending: [{ name: "crm", needs: ["CRM_TOKEN"], remote: false }],
      taken: false,
      saved: p.save,
      ...(p.save ? { project: { id: "prj_9", name: p.name ?? SUMMARY.name } } : {}),
    }),
  });
  const seen = await share.readProject({ content: "x" });
  assert.equal(seen?.saved, false);
  assert.deepEqual(calls[0]?.[1], { content: "x", save: false, replace: false });
  const got = await share.importProject({ link: "https://a.test/p/abc" }, false, "Otra");
  assert.equal(got?.project.id, "prj_9");
  assert.deepEqual(calls[1]?.[1], { link: "https://a.test/p/abc", name: "Otra", save: true, replace: false });
  await share.importProject({ content: "x" }, true);
  assert.deepEqual(calls[2]?.[1], { content: "x", save: true, replace: true });
});

test("un paquete rechazado devuelve undefined sin lanzar", async (t) => {
  mockRpc(t, { "projects.import": new Error("this file is not a Colonia project") });
  assert.equal(await share.readProject({ content: "hola" }), undefined);
  assert.equal(await share.importProject({ content: "hola" }, false), undefined);
});

test("publicar devuelve la ruta del enlace y dejar de publicar la quita", async (t) => {
  const calls = mockRpc(t, {
    "projects.share": (p: { shared: boolean }) => (p.shared ? { shared: true, path: "/p/abc" } : { shared: false }),
    "webhooks.get": { mode: "quick", url: "https://mi.example.test" },
  });
  assert.deepEqual(await share.publishProject("prj_1", true), { path: "/p/abc" });
  assert.deepEqual(await share.publishProject("prj_1", false), {});
  assert.deepEqual(calls[0]?.[1], { project: "prj_1", shared: true });
  assert.equal(await share.publicBase(), "https://mi.example.test");
});

test("sin dirección pública en marcha no hay base para el enlace", async (t) => {
  mockRpc(t, { "webhooks.get": { mode: "off", url: "https://vieja.example.test" } });
  assert.equal(await share.publicBase(), undefined);
});

test("«Default» no se ofrece para compartir: el core no lo tiene como proyecto", () => {
  assert.equal(share.canShareProject({ isDefault: true }), false);
  assert.equal(share.canShareProject({ isDefault: false }), true);
});

test("ENLACE-TEMPORAL-2 · dejar de publicar uno no cierra el enlace temporal mientras quede otro publicado", async (t) => {
  const calls = mockRpc(t, {
    "projects.share": (p: { project: string }) => ({ shared: false, left: p.project === "prj_a" ? 1 : 0 }),
    "webhooks.get": { mode: "cloudflare", url: "https://x.trycloudflare.com" },
    "webhooks.set": { mode: "off" },
  });
  assert.equal(await share.unpublishProject("prj_a"), true);
  assert.deepEqual(
    calls.map(([m]) => m),
    ["projects.share"],
  );
  assert.equal(await share.unpublishProject("prj_b"), true);
  assert.deepEqual(
    calls.map(([m]) => m),
    ["projects.share", "projects.share", "webhooks.get", "webhooks.set"],
  );
  assert.deepEqual(calls.at(-1)?.[1], { mode: "off" });
});
