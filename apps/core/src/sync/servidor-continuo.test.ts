import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47597";

test("el escritorio conserva sus preferencias y el servidor ejecuta cada turno una sola vez con el escritorio apagado", async () => {
  const serverHome = tempDir("colonia-continua-servidor-");
  const deskHome = tempDir("colonia-continua-escritorio-");
  let time = new Date("2026-11-02T10:00:00Z");
  const clock = () => time;
  const serverModel = scriptedLlm(() => say("Revisión terminada"));
  const deskModel = scriptedLlm(() => say("Revisión terminada"));
  const server = await startCore({ home: serverHome.path, clock, llm: serverModel });
  const bootDesk = () => startCore({ home: deskHome.path, clock, llm: deskModel });
  let desk = await bootDesk();
  const wait = (predicate: () => boolean | Promise<boolean>, what: string) => waitFor(predicate, what, { ms: 60000 });
  const advance = (minutes: number) => {
    time = new Date(Date.UTC(2026, 10, 2, 10, minutes, 5));
  };
  try {
    server.core.store.settings.set("user_language", '"en"');
    desk.core.store.settings.set("user_language", '"es"');
    const { project } = await desk.client.call("projects.create", { name: "Prueba de continuidad" });
    const routine = await desk.client.call("routines.set", {
      project: project.id,
      agent: "superagent",
      name: "Comprobar plano",
      prompt: "Revisa el plano de ejemplo",
      schedule: { kind: "every", minutes: 5 },
    });
    const { flow } = await desk.client.call("flows.create", {
      project: project.id,
      name: "Marca de revisión",
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: "reloj", kind: "schedule", cron: "*/5 * * * *", label: "Cada cinco minutos" },
          {
            id: "guarda",
            kind: "table_write",
            key: "ultima",
            label: "Última revisión",
            value: { kind: "event", path: ["scheduled_at"] },
          },
        ],
        edges: [{ source: "reloj", target: "guarda" }],
        layout: [],
      },
    });
    const graph = desk.core.store.flowGraphs.get(flow.id);
    await desk.client.call("flows.publish", {
      flow: flow.id,
      expectedDraftVersion: graph.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    await desk.client.call("flows.set", { ...flow, enabled: true });
    const shown = await server.client.call("sync.pair_start", { initial_source: "joining_device" });
    assert.equal(shown.pairing?.initial_source, "joining_device");
    assert.ok(shown.pairing?.code);
    const joined = await desk.client.call("sync.pair_join", {
      address: new URL(server.core.url).origin,
      code: shown.pairing.code,
    });
    assert.equal(joined.role, "secundario");
    await wait(
      () =>
        !!server.core.store.routines.get(routine.id) &&
        !!server.core.store.flowGraphs.get(flow.id).published &&
        server.core.store.settings.get("user_language") === '"es"',
      "llegan la preferencia elegida y las dos programaciones del escritorio",
    );
    assert.equal(desk.core.store.settings.get("user_language"), '"es"');
    assert.equal((await server.client.call("sync.status", {})).role, "principal");
    desk.core.scheduler.tick();
    server.core.scheduler.tick();
    const off = await desk.client.call("sync.status", {});
    assert.ok(off.connected);
    await desk.core.close();
    await wait(
      async () => !(await server.client.call("sync.status", {})).connected,
      "el servidor detecta que se cerró el escritorio",
    );
    const turns = async () => (await server.client.call("routines.runs", { routine: routine.id })).runs;
    const events = () => server.core.store.flows.events(flow.id, 20);
    const at = (m: number) => new Date(Date.UTC(2026, 10, 2, 10, m)).toISOString();
    for (const minute of [5, 10]) {
      advance(minute);
      server.core.scheduler.tick();
      server.core.scheduler.tick();
      await wait(
        async () =>
          (await turns()).length === minute / 5 &&
          (await turns()).every((run) => run.delivered !== undefined) &&
          events().length === minute / 5 &&
          server.core.store.flows.readRows(flow.id, ["ultima"]).ultima === at(minute),
        `turno del servidor a los ${minute} minutos`,
      );
    }
    desk = await bootDesk();
    desk.core.scheduler.tick();
    await wait(
      async () =>
        (await desk.client.call("sync.status", {})).connected &&
        desk.core.store.flows.readRows(flow.id, ["ultima"]).ultima === at(10) &&
        desk.core.store.routines.get(routine.id)?.last_run_at ===
          server.core.store.routines.get(routine.id)?.last_run_at,
      "el escritorio recupera las tablas de resultados y el reloj del servidor",
    );
    assert.equal((await desk.client.call("sync.status", {})).role, "secundario");
    advance(15);
    desk.core.scheduler.tick();
    server.core.scheduler.tick();
    desk.core.scheduler.tick();
    await wait(
      async () =>
        (await turns()).length === 3 &&
        events().length === 3 &&
        desk.core.store.flows.readRows(flow.id, ["ultima"]).ultima === at(15),
      "tercer turno recibido una vez tras reconectar",
    );
    assert.equal(deskModel.calls.length, 0);
    assert.equal(serverModel.calls.length, 3);
    assert.deepEqual(
      events()
        .map((event) => event.scheduled_at)
        .sort(),
      [at(5), at(10), at(15)],
    );
    assert.equal(desk.core.store.settings.get("user_language"), '"es"');
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});
