// VINCULAR-CLAVE-1 · Un servidor sin código de plantilla espera con una clave que solo sale en sus registros.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { LOG_KEY_FILE } from "./service.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47612";

const boot = async (home: string, server = false) => {
  if (server) process.env.COLONIA_PAIR_KEY_LOG = "on";
  try {
    return await startCore({ home, llm: scriptedLlm(() => say("Listo")) });
  } finally {
    delete process.env.COLONIA_PAIR_KEY_LOG;
  }
};
const keyIn = (home: string) => fs.readFileSync(path.join(home, LOG_KEY_FILE), "utf8").trim();
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return (err as { detail?: { refused?: string } }).detail?.refused;
  }
  assert.fail("debía rechazarse");
};

test("la clave de los registros: no se enseña, se bloquea a los 5 fallos, vale una vez", async () => {
  const serverHome = tempDir("colonia-clave-servidor-");
  const deskHome = tempDir("colonia-clave-escritorio-");
  const server = await boot(serverHome.path, true);
  const desk = await boot(deskHome.path);
  try {
    const first = keyIn(serverHome.path);
    assert.match(first, /^[2-9A-HJ-NP-Z]{8}$/);
    const st = await server.client.call("sync.status", {});
    assert.equal(st.paired, false);
    assert.equal(st.pairing, undefined, "la clave no sale en el estado");
    assert.ok(!JSON.stringify(st).includes(first));
    for (const route of ["/", "/health"]) {
      const body = await (await fetch(new URL(route, server.core.url))).text();
      assert.ok(!body.includes(first) && !body.includes(`${first.slice(0, 4)}-${first.slice(4)}`), route);
    }
    const address = new URL(server.core.url).origin;

    // Un código que no es la clave: «wrong», y la tarjeta sabe que el servidor contestó.
    assert.equal(await refusal(desk.client.call("sync.pair_join", { code: "ZZZZ-ZZZZ", address })), "wrong");
    for (let i = 0; i < 3; i++) await refusal(desk.client.call("sync.pair_join", { code: "YYYY-YYYY", address }));
    assert.equal(await refusal(desk.client.call("sync.pair_join", { code: "XXXX-XXXX", address })), "locked");
    const second = keyIn(serverHome.path);
    assert.notEqual(second, first, "tras 5 fallos se cambia");
    assert.equal(await refusal(desk.client.call("sync.pair_join", { code: first, address })), "wrong");

    const joined = await desk.client.call("sync.pair_join", { code: second.toLowerCase(), address });
    assert.equal(joined.paired, true);
    assert.equal((await server.client.call("sync.status", {})).role, "principal");
    assert.ok(!fs.existsSync(path.join(serverHome.path, LOG_KEY_FILE)), "gastada: se borra");
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});

test("la clave sobrevive a un reinicio y un escritorio sin servidor no abre ninguna", async () => {
  const home = tempDir("colonia-clave-reinicio-");
  let server = await boot(home.path, true);
  const key = keyIn(home.path);
  await server.core.close();
  server = await boot(home.path, true);
  const plain = tempDir("colonia-clave-normal-");
  const desk = await boot(plain.path);
  try {
    assert.equal(keyIn(home.path), key);
    assert.ok(!fs.existsSync(path.join(plain.path, LOG_KEY_FILE)));
    // Un escritorio sin invitación no conoce ningún código: «none».
    assert.equal(
      await refusal(server.client.call("sync.pair_join", { code: key, address: new URL(desk.core.url).origin })),
      "none",
    );
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});

test("VINCULAR-CLAVE-2 · desvincular dos veces (escritorio y luego servidor) no deja la clave muerta", async () => {
  const serverHome = tempDir("colonia-clave-doble-servidor-");
  const deskHome = tempDir("colonia-clave-doble-escritorio-");
  const otherHome = tempDir("colonia-clave-doble-otro-");
  const server = await boot(serverHome.path, true);
  const desk = await boot(deskHome.path);
  const other = await boot(otherHome.path);
  try {
    const address = new URL(server.core.url).origin;
    assert.equal((await desk.client.call("sync.pair_join", { code: keyIn(serverHome.path), address })).paired, true);
    await waitFor(async () => (await desk.client.call("sync.status", {})).connected, "enlazados", { ms: 30000 });
    await desk.client.call("sync.unpair", {});
    await waitFor(async () => !(await server.client.call("sync.status", {})).paired, "el servidor se entera del adiós");
    await waitFor(() => fs.existsSync(path.join(serverHome.path, LOG_KEY_FILE)), "clave nueva en los registros");
    // El dueño pulsa también «Desvincular» en el servidor, que ya estaba solo.
    await server.client.call("sync.unpair", {});
    // Se rearma en el siguiente tick (1 s): se reintenta unos segundos, como haría el dueño.
    let joined: { paired?: boolean } | undefined;
    await waitFor(
      async () => {
        try {
          joined = await other.client.call("sync.pair_join", { code: keyIn(serverHome.path), address });
        } catch {}
        return !!joined?.paired;
      },
      "la clave de los registros vuelve a abrir el servidor",
      { ms: 10000 },
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
