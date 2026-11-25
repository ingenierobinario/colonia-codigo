// Starts the staged core (apps/desktop/.stage/colonia) on an empty home and waits for /health: a bundle whose core cannot
// start never ships. See HISTORY.md#protocol-subpaths.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../..");
const stage = path.join(repo, "apps/desktop/.stage/colonia");
const DEADLINE_MS = 90_000;

const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
  });
});
const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-smoke-"));
const core = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/core/src/main.ts"], {
  cwd: stage,
  env: {
    ...process.env,
    COLONIA_HOME: home,
    COLONIA_PORT: String(port),
    COLONIA_SECRETS: "file",
    COLONIA_UPDATES: "off",
    COLONIA_TELEMETRY: "off",
    COLONIA_RUNTIME_SKILLS: "off",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [core.stdout, core.stderr]) stream.on("data", (d: Buffer) => (output = (output + d).slice(-8000)));
const exited = new Promise<number | null>((resolve) => core.on("exit", (code) => resolve(code)));
let gone = false;
void exited.then(() => {
  gone = true;
});

let healthy = false;
const until = Date.now() + DEADLINE_MS;
while (!healthy && !gone && Date.now() < until) {
  healthy = await fetch(`http://127.0.0.1:${port}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!healthy) await new Promise((r) => setTimeout(r, 500));
}
// The terminal's native pty must have survived staging (pty.node, spawn-helper, conpty.node): one echo through it.
const ptyShell =
  process.platform === "win32"
    ? [process.env.COMSPEC ?? "cmd.exe", "/c", "echo colonia-pty"]
    : ["/bin/sh", "-c", "echo colonia-pty"];
const pty = spawn(process.execPath, ["apps/core/src/terminal/pty-host.ts", "24", "80", ...ptyShell], {
  cwd: stage,
  // Match the real terminal: keep its input open and provide the resize pipe on fd 3.
  stdio: ["pipe", "pipe", "pipe", "pipe"],
  windowsHide: true,
});
let ptyOutput = "";
let ptyError = "";
let ptyTimedOut = false;
pty.stdout.on("data", (chunk: Buffer) => (ptyOutput = (ptyOutput + chunk).slice(-8000)));
pty.stderr.on("data", (chunk: Buffer) => (ptyError = (ptyError + chunk).slice(-8000)));
const ptyStatus = await new Promise<number | null>((resolve) => {
  const deadline = setTimeout(() => {
    ptyTimedOut = true;
    ptyError += "native pty command exceeded 10000 ms";
    pty.kill();
    for (const stream of pty.stdio) stream?.destroy();
    pty.unref();
    resolve(null);
  }, 10_000);
  pty.on("error", (error: Error) => {
    ptyError += error.message;
  });
  pty.on("close", (code) => {
    clearTimeout(deadline);
    resolve(code);
  });
});
if (!gone) core.kill();
await exited;
fs.rmSync(home, { recursive: true, force: true });
if (!healthy) {
  console.error(output);
  throw new Error(
    gone ? "the staged core exited before it answered /health" : "the staged core did not answer /health",
  );
}
console.log("staged core answered /health");
if (ptyTimedOut || ptyStatus !== 0 || !ptyOutput.includes("colonia-pty")) {
  console.error(ptyOutput, ptyError, ptyStatus);
  throw new Error("the staged terminal's native pty did not run a command");
}
console.log("staged terminal ran a command on its native pty");
