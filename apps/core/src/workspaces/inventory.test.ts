import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { homeFiles } from "../backup/inventory.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { workspaceRegistry } from "./registry.ts";

test("a business backup excludes sibling databases, account sessions and temporary credentials", async () => {
  const home = tempDir("workspace-inventory-").path;
  try {
    for (const file of [
      "workspaces/w_test/colonia.db",
      "workspaces/registry.json",
      "account/.claude/.credentials.json",
      "tmp/private",
      "media/keep.txt",
    ]) {
      const target = path.join(home, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "fixture");
    }
    assert.deepEqual(
      (await homeFiles(home, new Set())).map((entry) => entry.rel),
      ["media/keep.txt"],
    );
  } finally {
    await removeDir(home);
  }
});

test("the workspace directory persists outside the primary database and rejects a corrupt registry", async () => {
  const home = tempDir("workspace-registry-").path;
  try {
    const first = workspaceRegistry(home).create("Shop");
    workspaceRegistry(home).rename(first.id, "Studio");
    assert.equal(workspaceRegistry(home).get(first.id).name, "Studio");
    fs.writeFileSync(path.join(home, "workspaces", "registry.json"), "broken");
    assert.throws(() => workspaceRegistry(home).list());
    assert.throws(() => workspaceRegistry(home).create("Do not replace the directory"));
  } finally {
    await removeDir(home);
  }
});
