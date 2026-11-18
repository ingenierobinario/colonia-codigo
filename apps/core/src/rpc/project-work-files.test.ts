import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { readShared } from "../shared-projects.ts";

test("solo los archivos elegidos viajan entre dos Colonias y los existentes se conservan", async (t) => {
  const origin = await startCore({ llm: scriptedLlm(() => say("Origen")) });
  t.after(async () => {
    await origin.core.close();
    await origin.cleanup();
  });
  const target = await startCore({ llm: scriptedLlm(() => say("Destino")) });
  t.after(async () => {
    await target.core.close();
    await target.cleanup();
  });
  const { project } = await origin.client.call("projects.create", { name: "Taller" });
  const root = project.path;
  assert.ok(root);
  const plan = "planificación/Plan anual.txt";
  const entries = new Map([
    [plan, Buffer.from("Café\r\n")],
    ["imagen.bin", Buffer.from([0, 1, 254, 255])],
  ]);
  const names = [...entries.keys()];
  fs.mkdirSync(path.join(root, "planificación"));
  for (const [name, bytes] of entries) fs.writeFileSync(path.join(root, name), bytes);
  fs.writeFileSync(path.join(root, "otro.txt"), "privado de la prueba");
  const send = (files?: string[]) => origin.client.call("projects.export", { project: project.id, files });
  const empty = await send();
  assert.equal(empty.files, undefined);
  const selected = await send(names);
  assert.deepEqual(selected.files, names.toSorted());
  assert.ok(selected.files_digest);
  assert.ok(!selected.content.includes("otro.txt"));
  const published = await origin.client.call("projects.share", {
    project: project.id,
    shared: true,
    files: names,
    files_digest: selected.files_digest,
  });
  const token = published.path?.split("/").at(-1);
  assert.ok(token);
  const content = readShared(origin.home, token);
  assert.ok(content);
  const preview = await target.client.call("projects.import", { content, save: false, replace: false });
  assert.deepEqual(preview.files, selected.files);
  const imported = await target.client.call("projects.import", {
    content,
    save: true,
    replace: false,
    files_digest: preview.files_digest,
  });
  const dest = imported.project?.path;
  assert.ok(dest);
  for (const [name, bytes] of entries) assert.deepEqual(fs.readFileSync(path.join(dest, name)), bytes);
  assert.ok(!fs.existsSync(path.join(dest, "otro.txt")));
  fs.writeFileSync(path.join(dest, plan), "versión local");
  const again = await target.client.call("projects.import", { content, save: true, replace: true });
  assert.deepEqual(again.kept_files, names.toSorted());
  assert.equal(fs.readFileSync(path.join(dest, plan), "utf8"), "versión local");
  fs.writeFileSync(path.join(root, plan), "archivo cambiado");
  await assert.rejects(
    origin.client.call("projects.share", {
      project: project.id,
      shared: true,
      files: names,
      files_digest: selected.files_digest,
    }),
    /changed/,
  );
  await assert.rejects(
    target.client.call("projects.import", {
      content: (await send(names)).content,
      save: true,
      replace: true,
      files_digest: preview.files_digest,
    }),
    /changed/,
  );
  assert.equal(readShared(origin.home, token), content);
  const reopened = await send();
  assert.equal(reopened.files, undefined);
  assert.deepEqual(reopened.published_files, names.toSorted());
});

test("la selección rechaza nombres privados, rutas no portables, tamaños excesivos y archivos sensibles", async (t) => {
  const core = await startCore({ llm: scriptedLlm(() => say("Bien")) });
  t.after(async () => {
    await core.core.close();
    await core.cleanup();
  });
  const { project } = await core.client.call("projects.create", { name: "Material" });
  const root = project.path;
  assert.ok(root);
  fs.writeFileSync(path.join(root, "grande.bin"), Buffer.alloc(200_001));
  fs.writeFileSync(path.join(root, "nota.txt"), "Authorization: Bearer valor-de-prueba");
  for (const name of [".env", "Cookies", "Login Data", "CON.txt", "../afuera", "grande.bin", "nota.txt", "ausente"]) {
    await assert.rejects(
      core.client.call("projects.export", { project: project.id, files: [name] }),
      /work files|params/,
      name,
    );
  }
  const outside = path.join(core.home, "carpeta-del-test");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "informe.txt"), "fuera del proyecto");
  fs.symlinkSync(outside, path.join(root, "vinculo"), "junction");
  fs.linkSync(path.join(outside, "informe.txt"), path.join(root, "referencia.txt"));
  for (const name of ["vinculo/informe.txt", "referencia.txt"]) {
    await assert.rejects(core.client.call("projects.export", { project: project.id, files: [name] }), /work files/);
  }
  const original = await core.client.call("projects.export", { project: project.id });
  const pack = JSON.parse(original.content);
  const contents = (files: unknown[]) => JSON.stringify({ ...pack, organization: { areas: [], roles: [], files } });
  const replay = await core.client.call("projects.import", {
    content: contents([{ path: "vinculo/nuevo.txt", data: "eA==" }]),
    save: true,
    replace: true,
  });
  assert.deepEqual(replay.kept_files, ["vinculo/nuevo.txt"]);
  assert.ok(!fs.existsSync(path.join(outside, "nuevo.txt")));
  for (const files of [
    [{ path: "../afuera", data: "eA==" }],
    [{ path: "documento", data: "???" }],
    [
      { path: "x", data: "" },
      { path: "X/entrada", data: "" },
    ],
    [
      { path: "x", data: "" },
      { path: "X", data: "" },
    ],
  ]) {
    await assert.rejects(
      core.client.call("projects.import", { content: contents(files), save: false, replace: false }),
      /damaged/,
    );
  }
});
