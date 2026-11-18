import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinnedCatalog, refreshPinnedCatalogs } from "./pinnedCatalog.ts";

test("al reconectar se renueva el catálogo en uso y se descarta la respuesta de la conexión anterior", async () => {
  const first = Promise.withResolvers<{ items: string[] }>();
  const next = Promise.withResolvers<{ items: string[] }>();
  let calls = 0;
  const catalog = createPinnedCatalog({ items: [] as string[] }, () => (++calls === 1 ? first : next).promise);
  const pending = catalog.load();
  assert.equal(catalog.load(), pending);
  refreshPinnedCatalogs();
  const refreshed = catalog.load();
  assert.notEqual(refreshed, pending);
  next.resolve({ items: ["Nuevo"] });
  await refreshed;
  first.resolve({ items: ["Anterior"] });
  await pending;
  await catalog.load();
  assert.deepEqual(catalog.get(), { items: ["Nuevo"], loaded: true, failed: false });
  assert.equal(calls, 2);
});

test("la pantalla y la barra conservan un fallo de precarga hasta el reintento de la persona", async () => {
  let calls = 0;
  const catalog = createPinnedCatalog({ items: [] as string[] }, async () => {
    if (++calls === 1) throw new Error("Sin conexión");
    return { items: ["Trabajo"] };
  });
  await Promise.all([catalog.load(), catalog.load()]);
  assert.equal(calls, 1);
  assert.deepEqual(catalog.get(), { items: [], loaded: false, failed: true });
  await Promise.all([catalog.load(), catalog.load()]);
  assert.equal(calls, 1);
  assert.equal(catalog.get().failed, true);
  await catalog.load(true);
  await catalog.load();
  assert.equal(calls, 2);
  assert.deepEqual(catalog.get(), { items: ["Trabajo"], loaded: true, failed: false });
});

test("al reconectar se recupera un catálogo que sólo conocía la barra y cuya lectura falló", async () => {
  let connected = false;
  let calls = 0;
  const catalog = createPinnedCatalog({ items: [] as string[] }, async () => {
    calls++;
    if (!connected) throw new Error("Sin conexión");
    return { items: ["Trabajo"] };
  });
  await catalog.load();
  connected = true;
  refreshPinnedCatalogs();
  await catalog.load();
  assert.equal(calls, 2);
  assert.deepEqual(catalog.get(), { items: ["Trabajo"], loaded: true, failed: false });
});

test("ni una lectura antigua ni su error pueden pisar un guardado o una eliminación", async () => {
  for (const [after, fails] of [
    [["Nuevo"], false],
    [[], true],
  ] as const) {
    const slow = Promise.withResolvers<{ items: readonly string[] }>();
    const catalog = createPinnedCatalog({ items: [] as readonly string[] }, () => slow.promise);
    const reading = catalog.load();
    await catalog.save(async () => ({ items: after }));
    if (fails) slow.reject(new Error("Se cortó la lectura anterior"));
    else slow.resolve({ items: ["Borrado"] });
    await reading;
    assert.deepEqual(catalog.get(), { items: after, loaded: true, failed: false });
  }
});

test("las escrituras concurrentes mantienen el orden y un guardado fallido permite el siguiente", async () => {
  const catalog = createPinnedCatalog({ items: [] as string[] }, async () => ({ items: [] }));
  const gate = Promise.withResolvers<{ items: string[] }>();
  const calls: string[] = [];
  const first = catalog.save(() => {
    calls.push("primera");
    return gate.promise;
  });
  const second = catalog.save(async () => {
    calls.push("segunda");
    return { items: ["Última"] };
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["primera"]);
  const rejected = assert.rejects(first, /rechazado/);
  gate.reject(new Error("rechazado"));
  await rejected;
  await second;
  assert.deepEqual(calls, ["primera", "segunda"]);
  assert.deepEqual(catalog.get().items, ["Última"]);
});
