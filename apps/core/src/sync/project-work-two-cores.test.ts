import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47592";

test("dos Colonias copian únicamente las carpetas elegidas, confirman el binario y conservan los acuses al reiniciar", async () => {
  const deskHome = tempDir("colonia-copia-origen-");
  const serverHome = tempDir("colonia-copia-servidor-");
  const llm = scriptedLlm(() => say("Listo"));
  let server = await startCore({ home: serverHome.path, llm });
  const boot = () => startCore({ home: deskHome.path, llm });
  let desk = await boot();
  const wait = (check: () => Promise<boolean>, message: string) => waitFor(check, message, { ms: 45_000, every: 40 });
  const projects = async () => (await server.client.call("projects.list", {})).projects;
  try {
    const a = (await desk.client.call("projects.create", { name: "Carpeta con binarios" })).project;
    const b = (await desk.client.call("projects.create", { name: "Sin autorización inicial" })).project;
    assert.ok(a.path && b.path);
    const bytes = randomBytes(3 * 1024 * 1024 + 31);
    fs.writeFileSync(path.join(a.path, "muestra.bin"), bytes);
    fs.writeFileSync(path.join(a.path, ".env"), "SOLO_UNA_PRUEBA=excluido");
    fs.writeFileSync(path.join(b.path, "pendiente.bin"), "segundo proyecto");
    const invite = await server.client.call("sync.pair_start", { initial_source: "joining_device" });
    assert.ok(invite.pairing);
    await desk.client.call("sync.pair_join", { code: invite.pairing.code, address: server.core.url, projects: [a.id] });
    const done = async (n: number) => {
      const result = (await desk.client.call("sync.status", {})).project_files;
      assert.notEqual(result?.state, "failed", JSON.stringify(result));
      return result?.state === "done" && result.completed === n;
    };
    await wait(() => done(1), "el servidor comprueba la instantánea del proyecto y devuelve un acuse al escritorio");
    const at = await projects();
    const copy = at.find((p) => p.id === a.id)?.path;
    const other = at.find((p) => p.id === b.id)?.path;
    assert.ok(copy && other);
    assert.notEqual(copy, a.path);
    assert.deepEqual(fs.readFileSync(path.join(copy, "muestra.bin")), bytes);
    assert.equal(fs.existsSync(path.join(copy, ".env")), false);
    assert.equal(fs.existsSync(path.join(other, "pendiente.bin")), false);
    assert.equal((await desk.client.call("projects.list", {})).projects.find((p) => p.id === a.id)?.path, a.path);
    const first = (await desk.client.call("sync.status", {})).project_files;
    assert.equal(first?.projects, 1);
    assert.ok((first?.bytes ?? 0) >= bytes.length);
    // Se cerró la aplicación y vuelve a enviar la misma selección desde el panel.
    await desk.core.close();
    desk = await boot();
    await wait(async () => (await desk.client.call("sync.status", {})).connected, "el escritorio recupera su vínculo");
    await desk.client.call("sync.copy_projects", { projects: [a.id] });
    assert.deepEqual((await desk.client.call("sync.status", {})).project_files, first);
    assert.equal((await projects()).find((p) => p.id === a.id)?.path, copy);
    // La elección queda asociada al mismo servidor aunque los dos equipos se reinicien antes de enviarla.
    const port = Number(new URL(server.core.url).port);
    await server.core.close();
    await wait(
      async () => !(await desk.client.call("sync.status", {})).connected,
      "el escritorio detecta la desconexión",
    );
    const queued = await desk.client.call("sync.copy_projects", { projects: [b.id] });
    assert.equal(queued.project_files?.state, "working");
    assert.equal(queued.project_files.completed, 1);
    await desk.core.close();
    server = await startCore({ home: serverHome.path, port, llm });
    desk = await boot();
    await wait(() => done(2), "el segundo proyecto recibe su propia carpeta");
    const more = (await projects()).find((p) => p.id === b.id)?.path;
    assert.ok(more);
    assert.notEqual(more, copy);
    assert.equal(fs.readFileSync(path.join(more, "pendiente.bin"), "utf8"), "segundo proyecto");
    assert.deepEqual(fs.readFileSync(path.join(a.path, "muestra.bin")), bytes);
    await desk.client.call("sync.unpair", {});
    await assert.rejects(desk.client.call("sync.copy_projects", {}));
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});

test("una invitación ordinaria no admite carpetas aunque el escritorio las haya seleccionado", async () => {
  const llm = scriptedLlm(() => say("Listo"));
  const server = await startCore({ llm });
  const desk = await startCore({ llm });
  try {
    const p = (await desk.client.call("projects.create", { name: "Privado" })).project;
    const invite = await server.client.call("sync.pair_start", {});
    assert.ok(invite.pairing);
    await assert.rejects(
      desk.client.call("sync.pair_join", { code: invite.pairing.code, address: server.core.url, projects: [p.id] }),
    );
    assert.equal((await server.client.call("sync.status", {})).paired, false);
    assert.equal((await desk.client.call("sync.status", {})).project_files, undefined);
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});
