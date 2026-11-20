// AUTOVINCULAR-1 · El servidor de la plantilla de Railway nace con el código que generó el escritorio.
import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47611";

const bootWith = async (home: string, code?: string) => {
  if (code) process.env.COLONIA_PAIR_CODE = code;
  try {
    return await startCore({ home, llm: scriptedLlm(() => say("Listo")) });
  } finally {
    delete process.env.COLONIA_PAIR_CODE;
  }
};

test("el servidor arranca esperando al PC con el código de la plantilla, vale una vez y no se reabre", async () => {
  const serverHome = tempDir("colonia-auto-servidor-");
  const deskHome = tempDir("colonia-auto-escritorio-");
  const otherHome = tempDir("colonia-auto-otro-");
  let server = await bootWith(serverHome.path, "ABCD2345");
  const desk = await bootWith(deskHome.path);
  const other = await bootWith(otherHome.path);
  try {
    const shown = await server.client.call("sync.status", {});
    assert.equal(shown.paired, false);
    assert.equal(shown.pairing?.code, "ABCD-2345");
    assert.equal(shown.pairing?.initial_source, "joining_device");
    assert.ok(
      Date.parse(shown.pairing?.expires_at ?? "") - Date.now() > 23 * 3_600_000,
      "espera un día, no diez minutos",
    );
    const address = new URL(server.core.url).origin;

    // Un código distinto no entra.
    await assert.rejects(other.client.call("sync.pair_join", { code: "ZZZZ-ZZZZ", address }));
    assert.equal((await server.client.call("sync.status", {})).paired, false);

    const joined = await desk.client.call("sync.pair_join", { code: "ABCD2345", address });
    assert.equal(joined.paired, true);
    assert.equal(joined.role, "secundario");
    assert.equal((await server.client.call("sync.status", {})).role, "principal");

    // Gastado: otro equipo que lo conozca no se cuela, ni tras reiniciar ni tras desemparejar.
    await assert.rejects(other.client.call("sync.pair_join", { code: "ABCD2345", address }));
    await server.client.call("sync.unpair", {});
    await server.core.close();
    server = await bootWith(serverHome.path, "ABCD2345");
    const after = await server.client.call("sync.status", {});
    assert.equal(after.paired, false);
    assert.equal(after.pairing, undefined, "el código de la plantilla no se reabre");
    await assert.rejects(
      other.client.call("sync.pair_join", { code: "ABCD2345", address: new URL(server.core.url).origin }),
    );
  } finally {
    await other.core.close();
    await desk.core.close();
    await server.core.close();
    await other.cleanup();
    await desk.cleanup();
    await server.cleanup();
  }
});

test("un código de plantilla mal formado se ignora y el servidor arranca normal", async () => {
  const home = tempDir("colonia-auto-roto-");
  const server = await bootWith(home.path, "corto");
  try {
    const st = await server.client.call("sync.status", {});
    assert.equal(st.pairing, undefined);
  } finally {
    await server.core.close();
    await server.cleanup();
  }
});
