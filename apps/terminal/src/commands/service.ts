// colonia service: keep the core running on this machine (systemd user unit, launchd agent, or a Windows login entry).
// Local only: it never asks the core anything beyond /health.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exitWhenClosed } from "@colonia/protocol/exit";
import { coloniaHome, corePort, coreUp, serviceConnection } from "./local.ts";
import {
  appRoot,
  bundleRun,
  coreMain,
  LAUNCHD_LABEL,
  launchdPlist,
  lingerLine,
  NODE_FLAGS,
  type ServiceSpec,
  STOP_FILE,
  SYSTEMD_UNIT,
  serviceEnv,
  serviceNames,
  serviceOwnsHome,
  systemdDir,
  systemdProblem,
  systemdUnit,
  terminalMain,
  keptServiceEnv,
  serviceEnvFile,
  WINDOWS_RUN_VALUE,
  windowsRunCommand,
  windowsStopScript,
} from "./service-files.ts";

const USAGE = `colonia service install     Run the core in the background, started at login and again if it dies
colonia service uninstall
colonia service status
colonia service restart     (start: the same, or install when it is not installed yet)
colonia service logs [-n 100] [-f]   The core's log on this machine (<home>/logs/core.log; on Linux, the systemd journal)`;

/** The core exits with this code to be started again after an update (apps/core/src/updates.ts). */
const RESTART_CODE = 75;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export function sh(
  cmd: string,
  args: string[],
  inherit = false,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: inherit ? "inherit" : "pipe",
      windowsHide: true,
      env,
    });
    return { ok: true, out: out ?? "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message };
  }
}

const must = (cmd: string, args: string[]) => {
  const r = sh(cmd, args);
  if (!r.ok) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.out.trim()}`);
  return r.out;
};

const names = () => serviceNames(coloniaHome());

const systemdFile = () => path.join(systemdDir(process.env, os.homedir()), names().systemd);

/** Whether this user's services outlive their last logout; enabling it is tried where it needs no password. */
function linger(enable: boolean): "on" | "enabled" | "off" {
  const user = os.userInfo().username;
  const on = () => sh("loginctl", ["show-user", user, "-p", "Linger", "--value"]).out.trim() === "yes";
  if (on()) return "on";
  if (!enable) return "off";
  const mine = sh("loginctl", ["--no-ask-password", "enable-linger", user]).ok;
  if (!mine) sh("sudo", ["-n", "loginctl", "enable-linger", user]);
  return on() ? "enabled" : "off";
}
const launchdFile = () => path.join(os.homedir(), "Library", "LaunchAgents", `${names().launchd}.plist`);
const launchdTarget = () => `gui/${process.getuid?.() ?? 0}`;
const pidFile = (home: string) => path.join(home, "service.pid");

function refuseLegacyService(): void {
  if (names().systemd === SYSTEMD_UNIT) return;
  let text: string | undefined;
  let entry: string;
  if (process.platform === "win32") {
    entry = WINDOWS_RUN_VALUE;
    const r = sh("reg", ["query", RUN_KEY, "/v", entry]);
    if (r.ok) text = r.out;
  } else {
    entry =
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
        : path.join(systemdDir(process.env, os.homedir()), SYSTEMD_UNIT);
    if (fs.existsSync(entry)) text = fs.readFileSync(entry, "utf8");
  }
  if (text && serviceOwnsHome(text, process.platform, coloniaHome()))
    throw new Error(
      `This home has a legacy fixed-name service at ${entry}. Stop and remove that entry with the OS service manager, then run colonia service install --home "${coloniaHome()}". No service was changed.`,
    );
}

function installed(): boolean {
  refuseLegacyService();
  let text: string;
  if (process.platform === "win32") {
    const r = sh("reg", ["query", RUN_KEY, "/v", names().windows]);
    if (!r.ok) return false;
    text = r.out;
  } else {
    const file =
      process.platform === "linux" ? systemdFile() : process.platform === "darwin" ? launchdFile() : undefined;
    if (!file || !fs.existsSync(file)) return false;
    text = fs.readFileSync(file, "utf8");
  }
  if (!serviceOwnsHome(text, process.platform, coloniaHome()))
    throw new Error(
      `The local service entry belongs to another home. Inspect it with the OS service manager before changing it: ${coloniaHome()}`,
    );
  return true;
}

function spec(home: string): ServiceSpec {
  const env = { ...serviceEnv(process.env), COLONIA_HOME: home, COLONIA_PORT: String(corePort()) };
  const log = path.join(home, "logs", "core.log");
  if (process.env.COLONIA_APP) {
    const b = bundleRun(process.env.COLONIA_APP);
    return { node: b.node, main: b.core, cwd: b.cwd, env, log, label: names().launchd };
  }
  const main = coreMain();
  return { node: process.execPath, main, cwd: appRoot(main), env, log, label: names().launchd };
}

/** The terminal and the Node that run `colonia service run` on Windows (through `current` for a bundle install). */
const supervisorRun = () =>
  process.env.COLONIA_APP
    ? { node: bundleRun(process.env.COLONIA_APP).node, terminal: bundleRun(process.env.COLONIA_APP).terminal }
    : { node: process.execPath, terminal: terminalMain() };

export async function service(
  sub: string | undefined,
  opts: { home?: string | undefined; lines?: string | undefined; follow?: boolean | undefined } = {},
) {
  if (sub === "help") return console.log(USAGE);
  if (opts.home) process.env.COLONIA_HOME = path.resolve(opts.home);
  if (sub !== "run") console.log(`Target: this machine, home ${coloniaHome()} (COLONIA_URL does not control services).`);
  if (sub === "install") return install();
  if (sub === "logs") return logs(coloniaHome(), Number(opts.lines ?? 100), Boolean(opts.follow));
  if (sub === "uninstall") return uninstall();
  if (sub === "status") return status();
  if (sub === "restart") return restart();
  if (sub === "start") return installed() ? restart() : install();
  if (sub === "run") return supervise(opts.home ?? coloniaHome());
  throw new Error(USAGE);
}

export async function install(): Promise<void> {
  const home = coloniaHome();
  const { url } = serviceConnection();
  const wasInstalled = installed();
  if (!wasInstalled && (await coreUp(url)))
    throw new Error(
      `a core already answers on ${url} and it is not the service's. Stop it first (it may be \`pnpm dev\` or the desktop app), then run install again.`,
    );
  if (!["linux", "darwin", "win32"].includes(process.platform))
    throw new Error(`no service manager for ${process.platform}`);
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const s = spec(home);

  if (process.platform === "linux") {
    const reachable = sh("systemctl", ["--user", "show-environment"]);
    if (!reachable.ok) throw new Error(systemdProblem(reachable.out, os.userInfo().username));
    fs.mkdirSync(path.dirname(systemdFile()), { recursive: true });
    fs.writeFileSync(systemdFile(), systemdUnit(s));
    must("systemctl", ["--user", "daemon-reload"]);
    must("systemctl", ["--user", "enable", "--now", names().systemd]);
    if (wasInstalled) must("systemctl", ["--user", "restart", names().systemd]);
    console.log(`installed ${systemdFile()}`);
    console.log(`logs: journalctl --user -u ${names().systemd} -f`);
    console.log(lingerLine(linger(true), os.userInfo().username));
  } else if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(launchdFile()), { recursive: true });
    fs.writeFileSync(launchdFile(), launchdPlist(s));
    sh("launchctl", ["bootout", `${launchdTarget()}/${names().launchd}`]);
    must("launchctl", ["bootstrap", launchdTarget(), launchdFile()]);
    console.log(`installed ${launchdFile()}`);
    console.log(`logs: ${s.log}`);
  } else {
    const command = windowsCommand(home);
    if (wasInstalled) stopWindows(home);
    writeServiceEnv(home);
    must("reg", ["add", RUN_KEY, "/v", names().windows, "/t", "REG_SZ", "/d", command, "/f"]);
    startWindows(command);
    console.log(`installed the login entry ${names().windows}`);
    console.log(`logs: ${s.log}`);
  }
  console.log(`the core will listen on port ${corePort()}`);
}

export async function uninstall(): Promise<void> {
  const wasInstalled = installed();
  if (process.platform === "linux") {
    sh("systemctl", ["--user", "disable", "--now", names().systemd]);
    fs.rmSync(systemdFile(), { force: true });
    sh("systemctl", ["--user", "daemon-reload"]);
  } else if (process.platform === "darwin") {
    sh("launchctl", ["bootout", `${launchdTarget()}/${names().launchd}`]);
    fs.rmSync(launchdFile(), { force: true });
  } else if (process.platform === "win32") {
    if (wasInstalled) stopWindows(coloniaHome());
    sh("reg", ["delete", RUN_KEY, "/v", names().windows, "/f"]);
    fs.rmSync(serviceEnvFile(coloniaHome()), { force: true });
  }
  console.log("the core no longer runs as a service");
}

export async function status(): Promise<void> {
  const { url } = serviceConnection();
  let manager = "not installed";
  if (process.platform === "linux" && installed())
    manager = `systemd: ${sh("systemctl", ["--user", "is-active", names().systemd]).out.trim() || "unknown"}${linger(false) === "on" ? "" : ", stops when you log out (sudo loginctl enable-linger)"}`;
  else if (process.platform === "darwin" && installed()) {
    const r = sh("launchctl", ["print", `${launchdTarget()}/${names().launchd}`]);
    manager = r.ok ? `launchd: ${/^\s*state = (.+)$/m.exec(r.out)?.[1] ?? "loaded"}` : "launchd: installed, not loaded";
  } else if (process.platform === "win32" && installed()) manager = `login entry ${names().windows}`;
  console.log(`target   local machine, home ${coloniaHome()}`);
  console.log(`service  ${manager}`);
  console.log(`core     ${(await coreUp(url)) ? "answers" : "does not answer"} on ${url}`);
}

/** Whether this home's service is installed and, as far as the OS says, running. */
export function serviceState(): "running" | "stopped" | "none" | "unknown" {
  try {
    if (!installed()) return "none";
    if (process.platform === "linux")
      return sh("systemctl", ["--user", "is-active", names().systemd]).out.trim() === "active" ? "running" : "stopped";
    if (process.platform === "darwin") {
      const r = sh("launchctl", ["print", `${launchdTarget()}/${names().launchd}`]);
      return r.ok && /^\s*state = running$/m.test(r.out) ? "running" : "stopped";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function restart(): Promise<void> {
  if (!installed()) throw new Error("the service is not installed (colonia service install)");
  if (process.platform === "linux") must("systemctl", ["--user", "restart", names().systemd]);
  else if (process.platform === "darwin")
    must("launchctl", ["kickstart", "-k", `${launchdTarget()}/${names().launchd}`]);
  else {
    const command = stopWindows(coloniaHome());
    startWindows(command);
  }
  console.log("restarting the core");
}

/** The last `n` lines of a file, read from its end so a large log is not loaded whole. */
export function lastLines(file: string, n: number): string[] {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let text = "";
    for (let end = size; end > 0 && text.split("\n").length <= n + 1; ) {
      const start = Math.max(0, end - 64 * 1024);
      const chunk = Buffer.alloc(end - start);
      fs.readSync(fd, chunk, 0, chunk.length, start);
      text = chunk.toString("utf8") + text;
      end = start;
    }
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-n);
  } finally {
    fs.closeSync(fd);
  }
}

/** `colonia service logs`: this machine's core log, read from the file; never asks the core. */
export async function logs(home: string, n: number, follow: boolean): Promise<void> {
  if (!Number.isInteger(n) || n < 1) throw new Error("-n is a number of lines, like -n 100");
  const file = path.join(home, "logs", "core.log");
  if (!fs.existsSync(file)) {
    if (process.platform === "linux" && installed()) {
      console.log(
        `The service logs to the systemd journal:  journalctl --user -u ${names().systemd} -n ${n}${follow ? " -f" : ""}`,
      );
      return;
    }
    throw new Error(
      `no core log at ${file} yet: a core on this home writes it once it starts (desktop app, colonia service install or pnpm dev)`,
    );
  }
  for (const line of lastLines(file, n)) console.log(line);
  if (!follow) return;
  let at = fs.statSync(file).size;
  fs.watchFile(file, { interval: 500 }, (now) => {
    // A shorter file was started again: read it from the top.
    if (now.size < at) at = 0;
    if (now.size === at) return;
    const chunk = Buffer.alloc(now.size - at);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, chunk, 0, chunk.length, at);
    fs.closeSync(fd);
    at = now.size;
    process.stdout.write(chunk);
  });
  await new Promise(() => {});
}

/** The login entry's command: no settings in it, so the Run value stays a plain command line. */
function windowsCommand(home: string): string {
  return windowsRunCommand({ ...supervisorRun(), home, electron: Boolean(process.env.ELECTRON_RUN_AS_NODE) });
}

/** What the installer was told that a login will not be: an explicit port and a release feed, as systemd's unit keeps them. */
export function writeServiceEnv(home: string, env: NodeJS.ProcessEnv = process.env): void {
  const kept = Object.fromEntries(keptServiceEnv.filter((k) => env[k]).map((k) => [k, env[k] as string]));
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(serviceEnvFile(home), `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
}

/** Puts back what writeServiceEnv kept; a variable already set wins, and a missing or broken file changes nothing. */
export function readServiceEnv(home: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const kept = JSON.parse(fs.readFileSync(serviceEnvFile(home), "utf8")) as Record<string, unknown>;
    for (const k of keptServiceEnv) if (typeof kept[k] === "string") env[k] ||= kept[k];
  } catch {}
}

/**
 * Starts the login entry's command now, created by WMI rather than as a child: Windows' sshd ends every process of
 * the session when it closes, so a supervisor spawned from `colonia service install` over SSH died at logout.
 */
function startWindows(command: string) {
  const ps = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${command.replace(/'/g, "''")}' } | Out-Null`;
  must("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
}

function stopWindows(home: string) {
  const entry = must("reg", ["query", RUN_KEY, "/v", serviceNames(home).windows]);
  const command = /\sREG_SZ\s+([^\r\n]+)/.exec(entry)?.[1];
  if (!command) throw new Error("The Windows service entry has no command; no process was stopped.");
  const script = windowsStopScript(home, command);
  const ask = path.join(home, STOP_FILE);
  // Windows has no TERM: the supervisor is asked with a file, and only what does not obey is ended by force.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(ask, "");
  try {
    must("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  } finally {
    fs.rmSync(ask, { force: true });
  }
  fs.rmSync(pidFile(home), { force: true });
  return command;
}

/** `colonia service run`: keeps one core alive, started again with backoff whenever it exits. */
async function supervise(home: string): Promise<void> {
  process.env.COLONIA_HOME = home;
  readServiceEnv(home);
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const log = fs.createWriteStream(path.join(home, "logs", "core.log"), { flags: "a" });
  const s = spec(home);
  let child: ChildProcess | undefined;
  let backoff = 1000;
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  // Windows cannot send the core a TERM: it holds the core's stdin, and closing it is the request to stop cleanly.
  const windows = process.platform === "win32";
  const start = () => {
    const startedAt = Date.now();
    child = spawn(s.node, [...NODE_FLAGS, s.main], {
      cwd: s.cwd,
      env: { ...process.env, ...s.env, ...(windows ? { COLONIA_STOP_ON_STDIN: "1" } : {}) },
      stdio: [windows ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin?.on("error", () => {});
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    fs.writeFileSync(pidFile(home), JSON.stringify({ supervisor: process.pid, core: child.pid }));
    child.on("exit", (code) => {
      log.write(`${new Date().toISOString()} core exited (${code})\n`);
      if (stopped) return;
      if (Date.now() - startedAt > 60_000 || code === RESTART_CODE) backoff = 1000;
      retry = setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
  };
  const done = new Promise<void>((resolve) => {
    let asked: NodeJS.Timeout | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(retry);
      clearInterval(asked);
      // Ends on its own after a clean stop; by force only if the stop hangs.
      exitWhenClosed(0, 15_000);
      void stopCore(child, log, windows ? 10_000 : undefined).then(resolve);
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
    if (windows) {
      // `colonia service stop` asks with this file (nothing can signal this process); taking it is the answer.
      const ask = path.join(home, STOP_FILE);
      fs.rmSync(ask, { force: true });
      asked = setInterval(() => {
        if (!fs.existsSync(ask)) return;
        fs.rmSync(ask, { force: true });
        stop();
      }, 250);
    }
  });
  start();
  await done;
}

/**
 * Stops the core and closes its log so the supervisor can exit on its own: a process.exit with the child's pipes
 * still open can crash Node on Windows (a libuv assertion). A grandchild may hold the core's pipes open, so after
 * a short wait for the last output they are destroyed rather than awaited. A core whose stdin is held (Windows) is
 * asked by closing it: a kill there ends it at once, with its store open and its agents' programs left running.
 */
export async function stopCore(child: ChildProcess | undefined, log: fs.WriteStream, graceMs = 5000): Promise<void> {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.stdin && !child.stdin.destroyed) child.stdin.end();
    else child.kill();
    const late = setTimeout(() => child.kill("SIGKILL"), graceMs);
    await exited;
    clearTimeout(late);
  }
  if (child?.stdout && !child.stdout.destroyed) {
    let wait: NodeJS.Timeout | undefined;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      wait = setTimeout(resolve, 1000);
    });
    clearTimeout(wait);
  }
  for (const out of [child?.stdout, child?.stderr]) {
    out?.unpipe(log);
    out?.destroy();
  }
  await new Promise<void>((resolve) => log.end(() => resolve()));
}
