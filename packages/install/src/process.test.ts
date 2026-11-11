import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runProcess } from "./process.ts";

test("a detached app that immediately fails never reports a successful launch", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(3)"], {
      signal: AbortSignal.timeout(5000),
      detached: true,
      env: { ...process.env },
    }),
    /failed to start/,
  );
});

test("native launchers wait for the actual exit status", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(4)"], {
      signal: AbortSignal.timeout(5000),
      env: { ...process.env },
    }),
    /failed/,
  );
  await runProcess(process.execPath, ["-e", "process.exit(0)"], {
    signal: AbortSignal.timeout(5000),
    env: { ...process.env },
  });
});

test("a missing launcher reports an error", async () => {
  await assert.rejects(
    runProcess("colonia-missing-launcher", [], {
      signal: AbortSignal.timeout(5000),
      detached: true,
      env: { ...process.env },
    }),
    /ENOENT/,
  );
});

test("a failed start leaves what the app printed, from the folder it was started in", async () => {
  const output = path.join(os.tmpdir(), `colonia-launch-${process.pid}-${Date.now()}.log`);
  try {
    await assert.rejects(
      runProcess(process.execPath, ["-e", "console.error('cannot start in ' + process.cwd()); process.exit(1)"], {
        signal: AbortSignal.timeout(5000),
        detached: true,
        env: { ...process.env },
        cwd: os.tmpdir(),
        output,
      }),
      /failed to start/,
    );
    assert.match(fs.readFileSync(output, "utf8"), /cannot start in /);
    assert.ok(fs.readFileSync(output, "utf8").includes(path.basename(fs.realpathSync(os.tmpdir()))));
  } finally {
    fs.rmSync(output, { force: true });
  }
});

test("an app that dies after the usual wait is still caught by a longer one", async () => {
  const slow = ["-e", "setTimeout(() => process.exit(5), 400)"];
  const options = { signal: AbortSignal.timeout(5000), detached: true, env: { ...process.env } };
  await runProcess(process.execPath, slow, { ...options, settle: 50 });
  await assert.rejects(runProcess(process.execPath, slow, { ...options, settle: 3000 }), /failed to start \(5\)/);
});
