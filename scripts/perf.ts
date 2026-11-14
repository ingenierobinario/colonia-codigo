#!/usr/bin/env node
// `pnpm perf`: how light Colonia itself is, with the model's cost taken out (a fake model answers at once). Starts a core on
// a temp home and measures startup, idle memory and CPU, protocol latency, chat turns and the memory they leave
// behind, and the panel's bundle. Fails when a number goes over its budget in scripts/perf-budget.json.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fakeLlm } from "../e2e/fake-llm.ts";
import { bootFiles, bootProblems, bootReport, sumKb } from "./bundle.ts";
import { compileCacheEnv } from "./compile-cache.ts";

const root = path.resolve(import.meta.dirname, "..");
const budget = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "perf-budget.json"), "utf8")) as Record<
  string,
  number
>;
const port = Number(process.env.PERF_PORT ?? 7470);
const TURNS = Number(process.env.PERF_TURNS ?? 60);
const diagnostics = process.env.PERF_DIAGNOSTICS === "1";
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

// PERF-1: over node:http with one kept connection. Node's fetch answers a loopback request one Windows timer tick late
// (15 ms measured against an empty server), which would be charged to the core on every call.
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function rpc<T>(method: string, params: unknown = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      `${base}/rpc/${method}`,
      {
        method: "POST",
        agent,
        headers: { "content-type": "application/json", "idempotency-key": `perf-${seq++}` },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          text += d;
        });
        res.on("end", () => {
          try {
            const body = JSON.parse(text) as { ok: boolean; result: T; error?: { message: string } };
            if (body.ok) resolve(body.result);
            else reject(new Error(`${method}: ${body.error?.message}`));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(params));
  });
}

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let s = "";
    child.stdout.on("data", (d) => {
      s += d;
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(s.trim()));
  });

/** RSS in MB and CPU seconds of a process: from ps on macOS and Linux, from PowerShell on Windows (PERF-1: it has no ps). */
async function usage(pid: number): Promise<{ rss: number; cpu: number }> {
  if (process.platform === "win32") {
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-Process -Id ${pid}; [Console]::Out.Write(('{0} {1}' -f $p.WorkingSet64, $p.TotalProcessorTime.TotalMilliseconds.ToString([cultureinfo]::InvariantCulture)))`,
    ]);
    const [bytes = "0", ms = "0"] = out.split(/\s+/);
    return { rss: Number(bytes) / 1024 / 1024, cpu: Number(ms) / 1000 };
  }
  const out = await run("ps", ["-o", "rss=,time=", "-p", String(pid)]);
  const [rss = "0", time = "0:0"] = out.split(/\s+/);
  const parts = time.split(":").map(Number);
  const cpu = parts.reduce((acc, n) => acc * 60 + n, 0);
  return { rss: Number(rss) / 1024, cpu };
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

function walSequence(file: string): number | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const header = Buffer.alloc(32);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) return;
    return header.readUInt32BE(12);
  } catch {
    return;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const dist = path.join(root, "apps/web/dist");

/** Lazy screens that must stay their own chunk: one static import from the first screen would merge it into the entry. */
const LAZY_SCREENS = ["ProjectScreen", "ConfigModal", "ChannelScreen", "ResourcesScreen"];

// A core already on the port would answer for ours: the numbers, and its models, would be someone else's.
if (
  await fetch(`${base}/health`).then(
    () => true,
    () => false,
  )
)
  throw new Error(`port ${port} is taken (another Colonia core?): stop it or set PERF_PORT`);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-perf-"));
const llm = await fakeLlm();
const startCore = (coloniaHome: string) =>
  spawn(
    process.execPath,
    ["--no-warnings", ...(diagnostics ? ["--trace-gc"] : []), path.join(root, "apps/core/src/main.ts")],
    {
      cwd: root,
      stdio: ["ignore", diagnostics ? "pipe" : "ignore", "pipe"],
      env: coreEnv(coloniaHome),
    },
  );

// As the owner's core starts (pnpm app, pnpm dev): with the compile cache warm. A first start on a home of its own
// fills it, so a fresh checkout or a CI run measures the same thing.
const warm = startCore(path.join(home, "warm"));
warm.stdout?.resume();
for (let i = 0; i < 300; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {}
  await sleep(50);
}
warm.kill("SIGTERM");
await new Promise((r) => warm.once("exit", r));

const coreEpoch = Date.now();
const t0 = performance.now();
const core = startCore(path.join(home, "colonia"));
/** What a Windows process cannot start without (sockets, DLLs, temp): the rest of the environment stays out. PERF-1 */
function windowsEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return {};
  const keep = [
    "SystemRoot",
    "SystemDrive",
    "windir",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "ComSpec",
  ];
  return Object.fromEntries(keep.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])));
}
function coreEnv(coloniaHome: string): NodeJS.ProcessEnv {
  return {
    // No agent CLIs: the numbers are the core's own, whatever this machine has installed.
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: process.env.HOME ?? os.homedir(),
    ...windowsEnv(),
    ...compileCacheEnv(root),
    COLONIA_HOME: coloniaHome,
    COLONIA_TELEMETRY: "off",
    COLONIA_PORT: String(port),
    COLONIA_SECRETS: "file",
    COLONIA_UPDATES: "off",
    COLONIA_V1_HOME: path.join(home, "no-v1"),
    CLAUDE_CONFIG_DIR: path.join(home, "claude"),
    CODEX_HOME: path.join(home, "codex"),
    COLONIA_LLM_BASE_URL: llm.url,
    COLONIA_LLM_KEY: "perf",
    COLONIA_LLM_MODELS: "fake-1",
  };
}
let stderr = "";
let gcTrace = "";
core.stdout?.on("data", (data) => {
  if (gcTrace.length < 128_000) gcTrace += data;
});
core.stderr?.on("data", (d) => {
  stderr += d;
});
const results: Record<string, number> = {};
const turnSamples: Array<{
  send_ms: number;
  wait_ms: number;
  total_ms: number;
  start_ms: number;
  end_ms: number;
  wal_sequence?: number | undefined;
}> = [];
let failed = false;
try {
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    if (performance.now() - t0 > 30_000) throw new Error(`the core did not start:\n${stderr}`);
    await sleep(20);
  }
  results.startup_ms = performance.now() - t0;
  const pid = core.pid ?? 0;

  // Idle: once startup settles (V8 trims what loading took), then CPU over a quiet window.
  await sleep(Number(process.env.PERF_SETTLE_MS ?? 12_000));
  const idle0 = await usage(pid);
  await sleep(5000);
  const idle1 = await usage(pid);
  results.idle_rss_mb = idle1.rss;
  results.idle_cpu_pct = ((idle1.cpu - idle0.cpu) / 5) * 100;

  // Protocol latency: a read the panel makes all the time.
  const lat: number[] = [];
  for (let i = 0; i < 300; i++) {
    const s = performance.now();
    await rpc("threads.list");
    lat.push(performance.now() - s);
  }
  results.rpc_p50_ms = pct(lat, 0.5);
  results.rpc_p95_ms = pct(lat, 0.95);

  // Turns: the whole path but the model (context, tools, persistence, events).
  await rpc("models.set_config", { default: { model: "custom/fake-1", router: false } });
  const thread = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" });
  const turns: number[] = [];
  for (let i = 0; i < TURNS; i++) {
    const s = performance.now();
    const { run } = await rpc<{ run: { id: string } }>("threads.send", { thread: thread.id, text: `turn ${i}` });
    const sent = performance.now();
    const done = await rpc<{ state: string }>("runs.wait", { run: run.id, timeout_s: 30 });
    if (done.state !== "completed") throw new Error(`turn ${i} ended ${done.state}`);
    const ended = performance.now();
    turns.push(ended - s);
    turnSamples.push({
      send_ms: sent - s,
      wait_ms: ended - sent,
      total_ms: ended - s,
      start_ms: s - t0,
      end_ms: ended - t0,
      ...(diagnostics ? { wal_sequence: walSequence(path.join(home, "colonia", "colonia.db-wal")) } : {}),
    });
  }
  results.turn_p50_ms = pct(turns, 0.5);
  results.turn_p95_ms = pct(turns, 0.95);
  // What stays once the core is quiet again (V8 gives memory back after a few idle seconds).
  await sleep(Number(process.env.PERF_SETTLE_MS ?? 12_000));
  const after = await usage(pid);
  results.rss_after_turns_mb = after.rss;
  results.rss_growth_mb = after.rss - idle1.rss;
  const boot = bootFiles(dist);
  results.initial_bundle_gzip_kb = boot ? sumKb(dist, boot.initial) : Number.NaN;
  results.boot_gzip_kb = boot ? sumKb(dist, boot.files) : Number.NaN;

  console.log(`\nColonia perf (${TURNS} turns, fake model)\n`);
  for (const [k, v] of Object.entries(results)) {
    const limit = budget[k];
    const over = limit !== undefined && v > limit;
    if (over) failed = true;
    console.log(
      `${over ? "✘" : "✓"} ${k.padEnd(20)} ${v.toFixed(1).padStart(9)}${limit !== undefined ? `  (budget ${limit})` : ""}`,
    );
  }
  const bundleOver = ["initial_bundle_gzip_kb", "boot_gzip_kb"].some(
    (k) => (results[k] ?? 0) > (budget[k] ?? Infinity),
  );
  const problems = boot ? bootProblems(dist, boot, LAZY_SCREENS) : ["apps/web/dist is missing: run pnpm build:web"];
  for (const problem of problems) console.log(`✘ ${problem}`);
  if (problems.length) failed = true;
  if (boot && (bundleOver || problems.length)) console.log(`\nFirst load, per chunk:\n${bootReport(dist, boot)}`);
  const out = path.join(root, "e2e/.out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, diagnostics ? "perf-diagnostics.json" : "perf.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        results,
        budget,
        turn_samples: turnSamples,
        core_pid: core.pid,
        core_epoch_ms: coreEpoch,
        ...(diagnostics ? { gc_trace: gcTrace } : {}),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  core.kill("SIGTERM");
  await llm.close();
  await sleep(300);
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
