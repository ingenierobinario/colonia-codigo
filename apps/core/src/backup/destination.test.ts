import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { samePath } from "../paths.ts";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createBackup } from "./service.ts";

test("recuerda el destino de las copias tras reiniciar y avisa cuando se desconecta", async () => {
  await using home = tempDir();
  await using cloud = tempDir();
  const folder = path.join(cloud.path, "Copias de trabajo");
  const db = openDb(home.path);
  try {
    const deps = { home: home.path, db, secrets: createSecrets(home.path, "file", {}), version: "2", homeId: "a" };
    const backup = createBackup(deps);
    backup.create({ folder, password: "clave-de-prueba" });
    await backup.settled();
    const first = backup.status();
    assert.equal(first.state, "done");
    assert.ok(first.file);
    const file = first.file;
    const again = createBackup(deps);
    assert.ok(samePath(again.status().folder, folder), "recuerda el destino elegido en este equipo");
    assert.ok(
      again.list().some((x) => samePath(x.file, file)),
      "encuentra la copia al volver",
    );
    fs.renameSync(folder, path.join(cloud.path, "desmontada"));
    assert.equal(again.create({ password: "clave-de-prueba" }).why, "folder");
    assert.equal(fs.existsSync(folder), false, "no recrea en el disco local una carpeta de nube desconectada");
  } finally {
    db.close();
  }
});
