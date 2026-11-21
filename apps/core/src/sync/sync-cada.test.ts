// SYNC-CADA-1 e INVENTARIO-EQUIPOS-1 · Dos Colonias emparejadas: cada una cuenta de sí misma (versión, tipo, sistema) y lo
// que comparten; con «solo a mano» los cambios esperan a «Sincronizar ahora», y el ritmo elegido se queda al reiniciar.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { syncEvery } from "../config.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47596";

const until = (f: () => unknown | Promise<unknown>, what: string) =>
  waitFor(async () => Boolean(await f()), what, { ms: 20_000 });

test("el ritmo por defecto se lee con cuidado: solo −1, 0 o de 1 a 1440 minutos", () => {
  assert.equal(syncEvery(undefined), 5);
  assert.equal(syncEvery(""), 5);
  assert.equal(syncEvery("0"), 0);
  assert.equal(syncEvery("-1"), -1);
  assert.equal(syncEvery("15"), 15);
  assert.equal(syncEvery("2.5"), 5);
  assert.equal(syncEvery("9999"), 5);
  assert.equal(syncEvery("cada rato"), 5);
});

test("la pareja sale con su inventario; a mano, los cambios esperan a «Sincronizar ahora»", async () => {
  const homes = [tempDir("colonia-cada-a-").path, tempDir("colonia-cada-b-").path] as const;
  const boot = (home: string) => startCore({ home, llm: scriptedLlm(() => say("ok")) });
  const a = await boot(homes[0]);
  let b = await boot(homes[1]);
  try {
    const idle = await a.client.call("sync.status", {});
    assert.equal(idle.every_min, 0, "las pruebas arrancan al momento");
    assert.equal(idle.shared, undefined, "sin pareja no hay nada en común que contar");
    await assert.rejects(a.client.call("sync.now", {}), /pareja/);

    const shown = await a.client.call("sync.pair_start", {});
    assert.ok(shown.pairing?.code);
    await b.client.call("sync.pair_join", { code: shown.pairing.code });
    await until(async () => (await a.client.call("sync.status", {})).peer?.version !== undefined, "A no sabe qué es B");

    const seen = await a.client.call("sync.status", {});
    assert.equal(seen.peer?.kind, "pc");
    assert.ok(seen.peer?.platform, "falta el sistema del otro equipo");
    assert.ok(seen.peer?.seen_at, "falta cuándo se le vio");
    assert.ok(seen.shared, "falta lo que comparten");

    // Solo a mano en B: un proyecto nuevo se queda esperando…
    const manual = await b.client.call("sync.set_every", { minutes: -1 });
    assert.equal(manual.every_min, -1);
    assert.equal(manual.next_sync_at, undefined);
    await b.client.call("projects.create", { name: "Proyecto a mano", kind: "company" });
    await until(async () => (await b.client.call("sync.status", {})).pending > 0, "el cambio no quedó pendiente");
    await new Promise((r) => setTimeout(r, 2500));
    assert.ok((await b.client.call("sync.status", {})).pending > 0, "salió sin pulsar «Sincronizar ahora»");
    const listed = async () => (await a.client.call("projects.list", {})).projects.map((p) => p.name);
    assert.ok(!(await listed()).includes("Proyecto a mano"));

    // …hasta que se pulsa «Sincronizar ahora».
    await b.client.call("sync.now", {});
    await until(async () => (await listed()).includes("Proyecto a mano"), "«Sincronizar ahora» no lo mandó");
    await until(async () => (await b.client.call("sync.status", {})).pending === 0, "quedó algo por enviar");
    await until(
      async () => ((await a.client.call("sync.status", {})).shared?.projects ?? 0) >= 1,
      "el inventario no cuenta el proyecto",
    );

    // Con un ritmo de una hora se sabe cuándo sale la próxima tanda.
    const timed = await b.client.call("sync.set_every", { minutes: 60 });
    assert.equal(timed.every_min, 60);
    assert.ok(timed.next_sync_at && Date.parse(timed.next_sync_at) > Date.now() + 59 * 60_000);
    await assert.rejects(b.client.call("sync.set_every", { minutes: 7 } as never));

    // El ritmo es del equipo: sigue al reiniciar.
    await b.core.close();
    assert.ok(fs.existsSync(path.join(homes[1], "sincronizar-cada.json")));
    b = await boot(homes[1]);
    assert.equal((await b.client.call("sync.status", {})).every_min, 60);
  } finally {
    await a.core.close().catch(() => {});
    await b.core.close().catch(() => {});
    for (const h of homes) removeDir(h);
  }
});
