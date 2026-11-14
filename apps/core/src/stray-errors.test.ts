import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const run = (survive: boolean) =>
  spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--input-type=module",
      "-e",
      `import { surviveStrayErrors } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "stray-errors.ts")).href)};
       import { createLog } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "log.ts")).href)};
       if (${survive}) surviveStrayErrors(createLog("core"));
       void Promise.reject(new Error("stray rejection"));
       setTimeout(() => { throw new Error("stray throw"); }, 10);
       setTimeout(() => console.log("still serving"), 60);`,
    ],
    { encoding: "utf8" },
  );

test("ERR-3: a stray rejection and a stray throw are logged and the core keeps running", () => {
  const without = run(false);
  assert.notEqual(without.status, 0, "what Node does by itself: the process ends");
  assert.ok(!without.stdout.includes("still serving"));

  const r = run(true);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("still serving"));
  const lines = r.stderr
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { level: string; msg: string; err: string });
  assert.deepEqual(
    lines.map((l) => [l.level, l.msg.split(":")[0], l.err]),
    [
      ["error", "unhandled rejection", "stray rejection"],
      ["error", "uncaught exception", "stray throw"],
    ],
  );
});
