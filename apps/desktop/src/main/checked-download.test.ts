import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { fileDigest } from "./checked-download.ts";

test("large-file verification yields to desktop work and hashes every byte", async () => {
  const dir = tempDir("update-digest-");
  const file = path.join(dir.path, "update.zip");
  const bytes = Buffer.alloc(8 * 1024 * 1024, 37);
  await fs.promises.writeFile(file, bytes);
  let done = false;
  const result = fileDigest(file).finally(() => {
    done = true;
  });
  let turns = 0;
  while (!done) {
    await setImmediate();
    turns++;
  }
  assert.equal(await result, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(turns > 1, "other desktop work runs before verification completes");
  await assert.rejects(fileDigest(path.join(dir.path, "missing.zip")), /ENOENT/);
});
