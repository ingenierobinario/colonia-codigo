import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

process.env.COLONIA_SYNC_BEACON_PORT = "47641";

test("el servidor y el escritorio intercambian solo las carpetas autorizadas y conservan cambios tras una desconexión", async () => {
  const llm = scriptedLlm(() => say("Listo"));
  const deskHome = tempDir("colonia-continuo-escritorio-");
  const serverHome = tempDir("colonia-continuo-servidor-");
  const bootDesk = () => startCore({ home: deskHome.path, llm });
  let desk = await bootDesk();
  const server = await startCore({ home: serverHome.path, llm });
  const wait = (check: () => boolean | Promise<boolean>, why: string) => waitFor(check, why, { ms: 60_000, every: 80 });
  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file) : undefined);
  try {
    const a = (await desk.client.call("projects.create", { name: "Entregables" })).project;
    const b = (await desk.client.call("projects.create", { name: "Solo la primera copia" })).project;
    const local = a.path,
      other = b.path;
    assert.ok(local && other);
    fs.writeFileSync(path.join(local, "informe.txt"), "Primera versión");
    fs.writeFileSync(path.join(other, "privado.txt"), "Solo copia");
    await assert.rejects(desk.client.call("sync.set_folder_sync", { project: a.id, enabled: true }));
    const invite = await server.client.call("sync.pair_start", {
      initial_source: "joining_device",
      allow_managed_folder_sync: true,
    });
    assert.ok(invite.pairing);
    await assert.rejects(
      desk.client.call("sync.pair_join", {
        address: server.core.url,
        code: invite.pairing.code,
        projects: [a.id],
        continuous_projects: [b.id],
      }),
    );
    await desk.client.call("sync.pair_join", {
      address: server.core.url,
      code: invite.pairing.code,
      projects: [a.id, b.id],
      continuous_projects: [a.id],
    });
    await wait(
      async () => (await desk.client.call("sync.status", {})).project_files?.completed === 2,
      "el servidor recibió las dos copias ?nicas",
    );
    const remote = (await server.client.call("projects.list", {})).projects;
    const ra = remote.find((p) => p.id === a.id)?.path,
      rb = remote.find((p) => p.id === b.id)?.path;
    assert.ok(ra && rb && ra !== local && rb !== other);
    const status = async () =>
      (await desk.client.call("sync.status", {})).folder_sync?.projects.find((p) => p.id === a.id);
    await wait(async () => (await status())?.state === "current", "acuerdo inicial sobre el inventario");
    const bytes = randomBytes(2 * 1024 * 1024 + 117);
    fs.writeFileSync(path.join(local, "nuevos.bin"), bytes);
    fs.writeFileSync(path.join(local, ".env"), "FICTICIO=excluir");
    fs.writeFileSync(path.join(rb, "solo-servidor.txt"), "privado del servidor");
    await wait(
      () => Boolean(read(path.join(ra, "nuevos.bin"))?.equals(bytes)),
      "circula el binario completo hacia el servidor",
    );
    assert.equal(fs.existsSync(path.join(ra, ".env")), false);
    assert.equal(fs.existsSync(path.join(other, "solo-servidor.txt")), false);
    await desk.core.close();
    fs.writeFileSync(path.join(ra, "generado-en-el-servidor.txt"), "Resultado nocturno");
    fs.writeFileSync(path.join(ra, "informe.txt"), "Versión servidor");
    fs.writeFileSync(path.join(local, "informe.txt"), "Versión escritorio");
    fs.writeFileSync(path.join(local, "generado-en-el-escritorio.txt"), "Resultado local");
    desk = await bootDesk();
    await wait(
      () => read(path.join(local, "generado-en-el-servidor.txt"))?.toString() === "Resultado nocturno",
      "el trabajo nocturno llega al escritorio",
    );
    await wait(
      () => read(path.join(ra, "generado-en-el-escritorio.txt"))?.toString() === "Resultado local",
      "el trabajo local llega al servidor",
    );
    const reports = (root: string) =>
      fs
        .readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".txt"))
        .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
        .sort();
    await wait(
      () =>
        reports(ra).includes("Versión escritorio") &&
        reports(local).includes("Versión servidor") &&
        JSON.stringify(reports(ra)) === JSON.stringify(reports(local)),
      "ambos conservan las dos versiones concurrentes",
    );
    await desk.client.call("sync.set_folder_sync", { project: a.id, enabled: false });
    await wait(
      async () =>
        !(await server.client.call("sync.status", {})).folder_sync?.projects.find((p) => p.id === a.id)?.remote,
      "el servidor confirma la revocación",
    );
    fs.writeFileSync(path.join(ra, "despues-de-revocar.txt"), "permanecer aquí");
    await desk.core.close();
    desk = await bootDesk();
    await wait(async () => (await desk.client.call("sync.status", {})).connected, "la pareja se ha reconectado");
    assert.equal(Boolean((await status())?.local), false);
    assert.equal(fs.existsSync(path.join(local, "despues-de-revocar.txt")), false);
  } finally {
    await desk.core.close();
    await server.core.close();
    await desk.cleanup();
    await server.cleanup();
  }
});
