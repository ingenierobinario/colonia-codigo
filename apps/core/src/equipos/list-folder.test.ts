import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { runCommand } from "./ops.ts";
import { listFolderCommand } from "./ssh.ts";

test("revisa la carpeta elegida por el dueño incluidos espacios y corchetes en el nombre", async () => {
  await using dir = tempDir();
  const target = path.join(dir.path, "Informe O'Brien [equipo]");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "informe.txt"), "Prueba");
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
  const entries = await runCommand({ op: "run", command: listFolderCommand(os, target) });
  assert.equal(entries.exit_code, 0);
  assert.match(entries.output, /informe\.txt/);
  const missing = await runCommand({ op: "run", command: listFolderCommand(os, path.join(target, "no existe")) });
  assert.notEqual(missing.exit_code, 0);
});
