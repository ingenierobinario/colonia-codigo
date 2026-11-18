import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { linkTemporaryDesktop, updatedCore } from "./smoke-mac-update.ts";

const before = {
  name: "colonia-core",
  version: "2.1.0",
  code_sha: "987654321abc",
  home_id: "perfil-temporal",
  started_at: "2026-01-01T00:00:00Z",
};
const after = { ...before, version: "2.1.1", code_sha: "0123456789ab", started_at: "2026-01-01T00:03:00Z" };
const expected = { version: after.version, sha: after.code_sha };

test("identifica el motor de la candidata y conserva la Colonia que se actualizó", () => {
  assert.equal(updatedCore(before, after, expected), true);
});

test("rechaza el motor antiguo, otra compilación, otro perfil y una respuesta ajena", () => {
  for (const result of [
    before,
    { ...after, code_sha: "otro" },
    { ...after, home_id: "otro" },
    { ...after, name: "otro" },
    { ...after, started_at: before.started_at },
    { ...after, started_at: "" },
    { ...after, started_at: "2025-12-01T00:00:00Z" },
    undefined,
  ]) {
    assert.equal(updatedCore(before, result, expected), false);
  }
});

test("Finder recupera el perfil temporal del primer arranque y respeta un perfil preexistente", async () => {
  await using dir = tempDir();
  const temporary = path.join(dir.path, "perfil");
  const finder = path.join(dir.path, "Application Support", "desktop");
  const close = linkTemporaryDesktop(temporary, finder);
  try {
    fs.writeFileSync(path.join(temporary, "prueba"), "prueba");
    assert.equal(fs.readFileSync(path.join(finder, "prueba"), "utf8"), "prueba");
    assert.throws(() => linkTemporaryDesktop(path.join(dir.path, "otro"), finder), { code: "EEXIST" });
    assert.equal(fs.readFileSync(path.join(finder, "prueba"), "utf8"), "prueba");
  } finally {
    close();
  }
  assert.equal(fs.existsSync(finder), false);
  assert.equal(fs.readFileSync(path.join(temporary, "prueba"), "utf8"), "prueba");
});
