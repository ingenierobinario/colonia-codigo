// RECETA-1 · La vista previa de una receta nunca manda modo (nada se guarda), y al importar viaja el que eligió la persona.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const recipes = await import("./recipes.ts");
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

const FILE = "---\nname: factura\nrecipe: colonia-1\nmode: background\n---\n\n# Factura\n\n## Steps\n\n1. click\n";

test("mirar una receta no manda modo; importarla manda el que eligió la persona, y su ámbito", async (t) => {
  const said = { name: "factura", goal: "Factura", preferred: "background", steps: 1 };
  const calls = mockRpc(t, {
    "skills.recipe_import": (p: { mode?: string }) => ({ ...said, saved: Boolean(p.mode) }),
  });
  assert.deepEqual(await recipes.readRecipe(FILE), said);
  assert.deepEqual(calls[0]?.[1], { content: FILE, replace: false, target: "global" });
  // El fichero prefiere segundo plano; la persona elige en vivo.
  const got = await recipes.importRecipe(FILE, "live", true, "prj_1");
  assert.equal(got?.saved, true);
  assert.deepEqual(calls[1]?.[1], { content: FILE, mode: "live", replace: true, target: "project", project: "prj_1" });
});

test("un fichero que no es receta, o un fallo, devuelve undefined sin lanzar", async (t) => {
  mockRpc(t, { "skills.recipe_import": new Error("this file is not a Colonia recipe") });
  assert.equal(await recipes.readRecipe("hola"), undefined);
  assert.equal(await recipes.importRecipe("hola", "background", false), undefined);
});
