// Runs what a release ships on the runner that built it, before anything is published: installs the core bundle with
// install.sh/ps1 and starts it with the Node inside it, then starts the packaged app from its zip (verifying the mac
// signature first) and waits for its embedded core to answer /health. Everything lives in one temp folder; no service,
// no update feed. Only for a throwaway CI runner: install.ps1 writes the user PATH.
// Usage: node scripts/smoke-artifacts.ts <version> <os> <arch> <out-dir>
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE, coreBundleName, type Platform, targetOf } from "../packages/protocol/src/releases.ts";

/** The packaged app's executable inside its unpacked zip (relative path). */
export function appBinary(p: Platform): string {
  if (p.os === "mac") return path.join("Colonia.app", "Contents", "MacOS", "Colonia");
  return p.os === "win" ? "Colonia.exe" : "colonia";
}

/** The command that unpacks a zip on each OS without flattening the mac framework links. */
export function unzipCommand(p: Platform, zip: string, into: string): [string, string[]] {
  if (p.os === "mac") return ["/usr/bin/ditto", ["-x", "-k", zip, into]];
  // Windows' own bsdtar by full path: under Git Bash a bare "tar" is GNU tar, which cannot open a zip.
  if (p.os === "win") return [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", into]];
  return ["unzip", ["-q", zip, "-d", into]];
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status ?? r.signal}`);
}

function killTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** Starts `cmd` and waits up to `ms` for /health on `port`; throws with the child's last output when it never answers. */
async function answers(what: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, port: number, ms: number) {
  const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let output = "";
  for (const s of [child.stdout, child.stderr]) s?.on("data", (d: Buffer) => (output = (output + d).slice(-8000)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  try {
    const until = Date.now() + ms;
    while (!gone && Date.now() < until) {
      const ok = await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) return console.log(`${what} answered /health`);
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error(output);
    throw new Error(gone ? `${what} exited before it answered /health` : `${what} did not answer /health`);
  } finally {
    killTree(child);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }
}

const quiet = {
  COLONIA_UPDATES: "off",
  COLONIA_TELEMETRY: "off",
  COLONIA_RUNTIME_SKILLS: "off",
  COLONIA_RELEASES: "off",
};

async function smoke(version: string, p: Platform, out: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-artifacts-"));
  try {
    // a. The core bundle, installed by the install script and started with the Node it carries.
    const app = path.join(tmp, "app");
    const tarball = path.join(out, coreBundleName(version, p));
    const installEnv = { ...process.env, HOME: path.join(tmp, "user"), COLONIA_APP: app };
    fs.mkdirSync(installEnv.HOME, { recursive: true });
    if (p.os === "win")
      run(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(out, "install.ps1"),
          "-File",
          tarball,
          "-NoService",
        ],
        installEnv,
      );
    else run("bash", [path.join(out, "install.sh"), "--file", tarball, "--no-service"], installEnv);
    const current = path.join(app, BUNDLE.current);
    const corePort = await freePort();
    await answers(
      "installed core",
      path.join(current, ...BUNDLE.node(p.os === "win")),
      ["--disable-warning=ExperimentalWarning", path.join(current, ...BUNDLE.core)],
      {
        ...process.env,
        ...quiet,
        COLONIA_HOME: path.join(tmp, "core-home"),
        COLONIA_PORT: String(corePort),
        COLONIA_SECRETS: "file",
      },
      corePort,
      90_000,
    );

    // b. The packaged app from its zip (what the mac updater installs), on its own embedded core.
    const unpacked = path.join(tmp, "zip");
    fs.mkdirSync(unpacked);
    run(...unzipCommand(p, path.join(out, `Colonia-${version}-${p.os}-${p.arch}.zip`), unpacked));
    if (p.os === "mac") run("codesign", ["--verify", "--deep", "--strict", path.join(unpacked, "Colonia.app")]);
    const appPort = await freePort();
    const bin = path.join(unpacked, appBinary(p));
    const [cmd, args] = p.os === "linux" ? ["xvfb-run", ["-a", bin, "--no-sandbox"]] : [bin, []];
    await answers(
      "packaged app",
      cmd,
      args,
      {
        ...process.env,
        ...quiet,
        COLONIA_CONNECTION: "local",
        COLONIA_HOME: path.join(tmp, "app-home"),
        COLONIA_DESKTOP_DATA: path.join(tmp, "app-data"),
        COLONIA_PORT: String(appPort),
        COLONIA_QUIT_CONFIRM: "off",
      },
      appPort,
      120_000,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, osName, arch, out] = process.argv.slice(2);
  const p = targetOf(`${osName}-${arch}`, "", "");
  if (!version || !p || !out) {
    console.error("usage: node scripts/smoke-artifacts.ts <version> <os> <arch> <out-dir>");
    process.exit(2);
  }
  if (process.arch !== p.arch) console.log(`skipped: cross-arch (${p.arch} built on ${process.arch})`);
  else await smoke(version, p, path.resolve(out));
}
