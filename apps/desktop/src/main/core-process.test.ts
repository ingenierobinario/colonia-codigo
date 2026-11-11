import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeDir } from "../../../core/src/testkit/platform.ts";
import { startEmbeddedCore } from "./core-process.ts";

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Child did not reach the expected state");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function fixture(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-embedded-"));
  const main = path.join(dir, "colonia", "apps", "core", "src", "main.ts");
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.writeFileSync(main, source);
  return {
    dir,
    opts: {
      resources: dir,
      logFile: path.join(dir, "core.log"),
      cacheDir: path.join(dir, "cache"),
      home: dir,
      port: 17440,
      restartDelayMs: 300,
    },
  };
}

const record = `
  import fs from 'node:fs';
  import path from 'node:path';
  fs.appendFileSync(path.join(process.env.COLONIA_HOME, 'starts'), JSON.stringify({ home: process.env.COLONIA_HOME, port: process.env.COLONIA_PORT, app: process.env.COLONIA_APP, host: process.env.COLONIA_HOST, token: process.env.COLONIA_TOKEN }) + '\\n');
`;

test("an embedded child gets its explicit local target; stop is idempotent and waits for exit", {
  timeout: 10_000,
}, async () => {
  const { dir, opts } = fixture(`${record}\nsetInterval(() => {}, 1000);`);
  const oldHost = process.env.COLONIA_HOST;
  const oldToken = process.env.COLONIA_TOKEN;
  process.env.COLONIA_HOST = "0.0.0.0";
  process.env.COLONIA_TOKEN = "ambient-test-token";
  const core = startEmbeddedCore(opts);
  if (oldHost === undefined) delete process.env.COLONIA_HOST;
  else process.env.COLONIA_HOST = oldHost;
  if (oldToken === undefined) delete process.env.COLONIA_TOKEN;
  else process.env.COLONIA_TOKEN = oldToken;
  try {
    const file = path.join(dir, "starts");
    // The child appends one line: wait for its newline, not just the file, or the read can see it half written.
    await until(() => fs.existsSync(file) && fs.readFileSync(file, "utf8").endsWith("\n"));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      home: dir,
      port: "17440",
      app: "",
      host: "127.0.0.1",
    });
    await Promise.all([core.stop(), core.stop()]);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 1);
  } finally {
    await core.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stopping during backoff cancels a queued restart", { timeout: 10_000 }, async () => {
  const { dir, opts } = fixture(`${record}\nprocess.exit(1);`);
  const core = startEmbeddedCore(opts);
  try {
    await until(() => fs.readFileSync(opts.logFile, "utf8").includes("core exited"));
    await core.stop();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fs.readFileSync(path.join(dir, "starts"), "utf8").trim().split("\n").length, 1);
  } finally {
    await core.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop first closes the core's stdin, so it can end cleanly before any kill", { timeout: 10_000 }, async () => {
  const { dir, opts } = fixture(`
    import fs from 'node:fs';
    import path from 'node:path';
    const flag = process.env.COLONIA_STOP_ON_STDIN;
    fs.writeFileSync(path.join(process.env.COLONIA_HOME, 'ready'), String(flag));
    process.stdin.on('end', () => { fs.writeFileSync(path.join(process.env.COLONIA_HOME, 'clean'), 'yes'); process.exit(0); });
    process.stdin.resume();
    setInterval(() => {}, 1000);
  `);
  const core = startEmbeddedCore(opts);
  try {
    await until(() => fs.existsSync(path.join(dir, "ready")));
    assert.equal(fs.readFileSync(path.join(dir, "ready"), "utf8"), "1");
    const started = Date.now();
    await core.stop();
    assert.equal(fs.readFileSync(path.join(dir, "clean"), "utf8"), "yes");
    assert.ok(Date.now() - started < 4000, "ended by the closed stdin, not by the kill");
  } finally {
    await core.stop();
    await removeDir(dir);
  }
});
