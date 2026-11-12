import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../../../core/src/testkit/platform.ts";
import * as core from "./core-process.ts";
import { startEmbeddedCore } from "./core-process.ts";
import { waiting, waitingText } from "./remote-wait.ts";

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Child did not reach the expected state");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function fixture(source: string, into?: string) {
  const dir = into ?? fs.mkdtempSync(path.join(os.tmpdir(), "colonia-embedded-"));
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

// PUERTO-AJENO-1 / ADOPTAR-CORE-1: what holds the core's port decides whether the app starts its own core.
async function serve(handler: http.RequestListener, port = 0): Promise<http.Server & { port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return Object.assign(server, { port: (server.address() as { port: number }).port });
}
const close = (s: http.Server) => new Promise<void>((resolve) => s.close(() => resolve()));
const colonia: http.RequestListener = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, result: { name: "colonia-core", home_id: "x" } }));
};
const starts = (dir: string) =>
  fs.existsSync(path.join(dir, "starts"))
    ? fs.readFileSync(path.join(dir, "starts"), "utf8").trim().split("\n").length
    : 0;

test("a program that is not Colonia answering 200 on /health is not a core that is up", async () => {
  const other = await serve((_req, res) => res.end("ok"));
  try {
    assert.equal(await core.isUp(`http://127.0.0.1:${other.port}`), false);
  } finally {
    await close(other);
  }
  const real = await serve(colonia);
  try {
    assert.equal(await core.isUp(`http://127.0.0.1:${real.port}`), true);
  } finally {
    await close(real);
  }
});

test("another program on the port: no core is started, the wait ends early and the screen names the way out", {
  timeout: 20_000,
}, async () => {
  const other = await serve((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await using dir = tempDir("colonia-port-");
  const { opts } = fixture(`${record}\nsetInterval(() => {}, 1000);`, dir.path);
  const url = `http://127.0.0.1:${other.port}`;
  const embedded = core.startEmbeddedCore({ ...opts, port: other.port, adoptMs: 600, watchMs: 300 });
  try {
    const started = Date.now();
    assert.equal(await core.waitUp(url, 10_000), false);
    assert.ok(Date.now() - started < 8000, "the wait stops once the port is known to be taken");
    const problem = core.portProblem?.(url);
    assert.ok(problem, "the taken port is reported");
    assert.equal(problem.port, other.port);
    assert.equal(problem.envFile, path.join(dir.path, "core.env"));
    assert.ok(problem.freePort && problem.freePort !== other.port);
    if (process.platform === "win32") assert.match(problem.program ?? "", /node/i);
    assert.equal(starts(dir.path), 0, "no core was started against a taken port");
    const remote = { where: "here", url, local: "See the log" };
    const es = waitingText(waiting(remote, true, true));
    assert.match(es, new RegExp(`Otro programa.*puerto ${other.port}`));
    assert.match(es, new RegExp(`COLONIA_PORT=${problem.freePort}`));
    assert.match(waitingText(waiting(remote, true, false)), /Another program .*Close it/);
    // Once the program goes away, the app starts its own core by itself.
    await close(other);
    await until(() => starts(dir.path) === 1);
    assert.equal(core.portProblem?.(url), undefined);
  } finally {
    await embedded.stop();
    if (other.listening) await close(other);
  }
});

test("a Colonia core that answers on the port (the service, started at the same time) is adopted, not fought", {
  timeout: 20_000,
}, async () => {
  // The service binds the port but its /health only answers a moment later, as a core still starting does.
  let ready = false;
  const service = await serve((req, res) => {
    if (!ready) {
      res.writeHead(503);
      res.end();
      return;
    }
    colonia(req, res);
  });
  setTimeout(() => (ready = true), 1000);
  await using dir = tempDir("colonia-adopt-");
  const { opts } = fixture(`${record}\nsetInterval(() => {}, 1000);`, dir.path);
  const url = `http://127.0.0.1:${service.port}`;
  const embedded = core.startEmbeddedCore({ ...opts, port: service.port, adoptMs: 5000, watchMs: 300 });
  try {
    assert.equal(await core.waitUp(url, 8000), true);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(starts(dir.path), 0, "the app did not start a second core");
    assert.equal(core.portProblem?.(url), undefined);
    assert.doesNotMatch(fs.readFileSync(opts.logFile, "utf8"), /core exited/);
    // When the service goes away, the app's own core takes over.
    await close(service);
    await until(() => starts(dir.path) === 1);
  } finally {
    await embedded.stop();
    if (service.listening) await close(service);
  }
});

test("a core that loses the race for the port adopts the one that won it instead of retrying", {
  timeout: 20_000,
}, async () => {
  // The child stands in for a core that dies on a taken port; the winner starts answering right as it dies.
  await using dir = tempDir("colonia-race-");
  const probe = await serve(() => {});
  const port = probe.port;
  await close(probe);
  const { opts } = fixture(`${record}\nprocess.exit(1);`, dir.path);
  const url = `http://127.0.0.1:${port}`;
  const embedded = core.startEmbeddedCore({ ...opts, port, adoptMs: 3000, watchMs: 300, restartDelayMs: 200 });
  let winner: (http.Server & { port: number }) | undefined;
  try {
    await until(() => starts(dir.path) === 1);
    winner = await serve(colonia, port);
    assert.equal(await core.waitUp(url, 5000), true);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(starts(dir.path), 1, "no further start while the other core serves the port");
  } finally {
    await embedded.stop();
    if (winner) await close(winner);
  }
});

test("a core that dies young while the port is still free waits briefly for another core taking its home", {
  timeout: 20_000,
}, async () => {
  // The service holds the home (so ours dies at once) but binds the port only a moment later.
  await using dir = tempDir("colonia-home-race-");
  const probe = await serve(() => {});
  const port = probe.port;
  await close(probe);
  const { opts } = fixture(`${record}\nprocess.exit(1);`, dir.path);
  const embedded = core.startEmbeddedCore({ ...opts, port, adoptMs: 4000, watchMs: 300, restartDelayMs: 200 });
  let service: (http.Server & { port: number }) | undefined;
  try {
    await until(() => starts(dir.path) === 1);
    await new Promise((r) => setTimeout(r, 1500));
    service = await serve(colonia, port);
    assert.equal(await core.waitUp(`http://127.0.0.1:${port}`, 5000), true);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(starts(dir.path), 1, "no second start while the other core was coming up");
  } finally {
    await embedded.stop();
    if (service) await close(service);
  }
});
