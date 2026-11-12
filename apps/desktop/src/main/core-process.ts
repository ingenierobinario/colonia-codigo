import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const RESTART_CODE = 75;
const READY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const ROTATE_BYTES = 20 * 1024 * 1024;
/** How long a core asked to stop (its stdin closed) has to close its store and agents before it is killed. */
const CLEAN_STOP_MS = 5000;

/** How long a port that is taken but not answering as Colonia gets to turn out to be a Colonia core still starting. */
const ADOPT_MS = 8000;
/** While another program holds the port, or a core this app did not start serves it, how often to look again. */
const WATCH_MS = 2000;

export type EmbeddedCore = {
  stop(): Promise<void>;
  /** True while a core this app did not start (the service) serves the port and this one stands by. */
  adopted(): boolean;
};

/**
 * The port of this computer's core is taken by a program that is not Colonia, or by a Colonia core of another folder
 * (`otherHome`): what the waiting screen tells the owner.
 */
export type PortProblem = { port: number; program?: string; freePort?: number; envFile: string; otherHome?: true };
const portProblems = new Map<number, PortProblem>();

const portOf = (url: string) => Number(new URL(url).port || 80);

/** Set while the embedded core cannot start because another program holds its port (PUERTO-AJENO-1). */
export function portProblem(url: string): PortProblem | undefined {
  try {
    return portProblems.get(portOf(url));
  } catch {
    return undefined;
  }
}

/** The names a Colonia core gives on /health: before v2.13.0 it answered "apx-core" (6be00e4b3). */
const CORE_NAMES = new Set(["colonia-core", "apx-core"]);

/** /health of a Colonia core, or undefined for anything else (PUERTO-AJENO-1). */
async function coreHealth(url: string): Promise<{ home_id?: unknown } | undefined> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return undefined;
    const body = (await r.json()) as { result?: { name?: unknown; home_id?: unknown } };
    return body?.result && CORE_NAMES.has(String(body.result.name)) ? body.result : undefined;
  } catch {
    return undefined;
  }
}

/** Only a Colonia core counts as up: any other program answering 200 on /health is not one (PUERTO-AJENO-1). */
export async function isUp(url: string): Promise<boolean> {
  return (await coreHealth(url)) !== undefined;
}

function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (taken: boolean) => {
      socket.destroy();
      resolve(taken);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function nextFreePort(port: number): Promise<number | undefined> {
  for (let p = port + 1; p <= Math.min(port + 50, 65535); p++) if (await portFree(p)) return p;
  return undefined;
}

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(file, args, { timeout: 3000, windowsHide: true }, (_e, out) => resolve(String(out ?? ""))),
  );

/** The name of the program listening on the port, when the system says (best effort: undefined otherwise). */
export async function portOwner(port: number): Promise<string | undefined> {
  if (process.platform === "win32") {
    const line = (await run("netstat", ["-ano", "-p", "TCP"]))
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .find((c) => c.length >= 5 && c[1]?.endsWith(`:${port}`) && /:0$/.test(c[2] ?? ""));
    const pid = line?.[4];
    if (!pid || !/^\d+$/.test(pid) || pid === "0") return undefined;
    const csv = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return /^"([^"]+)"/.exec(csv.trim())?.[1];
  }
  const out = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fc"]);
  return /^c(.+)$/m.exec(out)?.[1];
}

/**
 * Who holds the port: nobody, a Colonia core of this folder (`colonia`), one of another folder (`otherHome`: its home_id
 * is not the one in `home`), or another program. A taken port gets `adoptMs` to answer as Colonia;
 * with `expectColonia` a free one does too (our core just died young: maybe another core holds the home and is starting).
 */
async function whoHolds(
  url: string,
  port: number,
  home: string,
  adoptMs: number,
  expectColonia = false,
): Promise<"free" | "colonia" | "otherHome" | "other"> {
  const until = Date.now() + adoptMs;
  while (true) {
    const health = await coreHealth(url);
    if (health) {
      let expected = "";
      try {
        expected = fs.readFileSync(path.join(home, "home-id"), "utf8").trim();
      } catch {}
      // ADOPTAR-CORE-1: this folder's core writes home-id before /health answers, so a folder without one is not
      // what answers here. A core too old to report home_id is still taken as this folder's when the folder has one.
      if (!expected) return "otherHome";
      return typeof health.home_id !== "string" || health.home_id.trim() === expected ? "colonia" : "otherHome";
    }
    if (!(await portTaken(port)) && (!expectColonia || Date.now() >= until)) return "free";
    if (Date.now() >= until) return "other";
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Supervises only the bundled child at the explicit local home/port, never an endpoint supplied by COLONIA_URL. */
export function startEmbeddedCore(opts: {
  resources: string;
  logFile: string;
  cacheDir: string;
  home: string;
  port: number;
  restartDelayMs?: number;
  /** Tests shorten the wait for a starting core and the watch while another one holds the port. */
  adoptMs?: number;
  watchMs?: number;
}): EmbeddedCore {
  const root = path.join(opts.resources, "colonia");
  const build = readBuild(root);
  fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
  if ((fs.statSync(opts.logFile, { throwIfNoEntry: false })?.size ?? 0) > ROTATE_BYTES)
    fs.renameSync(opts.logFile, `${opts.logFile}.1`);
  const log = fs.openSync(opts.logFile, "a");
  let child: ChildProcess | undefined;
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;
  let backoff = opts.restartDelayMs ?? 1000;
  const url = `http://127.0.0.1:${opts.port}`;
  const watchMs = opts.watchMs ?? WATCH_MS;

  // Before each start: a Colonia core already on the port (the service, started at the same time) is adopted instead of
  // fighting it for the port; another program on it is named on the waiting screen. Both are looked at again until the
  // port frees up, so the app starts its own core only then (ADOPTAR-CORE-1, PUERTO-AJENO-1).
  let adopted = false;
  const launch = async (diedYoung = false) => {
    if (stopped) return;
    // An adopted core that went away is probably restarting (`colonia service restart`): it gets the same short wait.
    const home = path.resolve(opts.home);
    const holder = await whoHolds(url, opts.port, home, opts.adoptMs ?? ADOPT_MS, diedYoung || adopted);
    if (stopped) return;
    adopted = holder === "colonia";
    if (holder === "free") {
      portProblems.delete(opts.port);
      start();
      return;
    }
    backoff = opts.restartDelayMs ?? 1000;
    if (holder === "colonia") portProblems.delete(opts.port);
    else if (!portProblems.has(opts.port)) {
      const [program, freePort] = await Promise.all([
        holder === "other" ? portOwner(opts.port) : undefined,
        nextFreePort(opts.port),
      ]);
      if (stopped) return;
      portProblems.set(opts.port, {
        port: opts.port,
        ...(holder === "otherHome" ? { otherHome: true as const } : {}),
        ...(program ? { program } : {}),
        ...(freePort ? { freePort } : {}),
        envFile: path.join(path.resolve(opts.home), "core.env"),
      });
      const by = holder === "otherHome" ? "a Colonia core of another folder" : (program ?? "another program");
      fs.writeSync(log, `${new Date().toISOString()} port ${opts.port} is taken by ${by}\n`);
    }
    retry = setTimeout(() => void launch(), watchMs);
  };

  const start = () => {
    if (stopped) return;
    const startedAt = Date.now();
    child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(root, "apps", "core", "src", "main.ts")],
      {
        cwd: root,
        // The core stops cleanly when this pipe closes (stopWhenParentCloses): Windows has no TERM to ask it with.
        stdio: ["pipe", log, log],
        windowsHide: true,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("COLONIA_"))),
          COLONIA_HOST: "127.0.0.1",
          ELECTRON_RUN_AS_NODE: "1",
          NODE_COMPILE_CACHE: opts.cacheDir,
          COLONIA_APP: "",
          COLONIA_HOME: path.resolve(opts.home),
          COLONIA_PORT: String(opts.port),
          COLONIA_WEB_DIST: path.join(root, "apps", "web", "dist"),
          COLONIA_UPDATES: "app",
          COLONIA_SUPERVISED: "1",
          COLONIA_CODE_SHA: build.sha ?? "",
          COLONIA_STOP_ON_STDIN: "1",
        },
      },
    );
    const finished = (code: number | null) => {
      if (stopped) return;
      fs.writeSync(log, `${new Date().toISOString()} core exited (${code})\n`);
      const diedYoung = Date.now() - startedAt <= 60_000 && code !== RESTART_CODE;
      if (!diedYoung) backoff = opts.restartDelayMs ?? 1000;
      // A core that dies young may have lost the port or its home to another core starting at the same time.
      retry = setTimeout(() => void launch(diedYoung), backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    // A core that already ended breaks the pipe; that must not throw in the app.
    child.stdin?.on("error", () => {});
    child.once("exit", finished);
    child.once("error", () => finished(null));
  };
  void launch();
  return {
    adopted: () => adopted && !stopped,
    stop() {
      if (stopping) return stopping;
      stopped = true;
      clearTimeout(retry);
      portProblems.delete(opts.port);
      stopping = new Promise<void>((resolve) => {
        const close = () => {
          fs.closeSync(log);
          resolve();
        };
        if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return close();
        const current = child;
        // First ask: closing stdin lets the core close its store and stop its agents' programs.
        const kill = setTimeout(() => current.kill(), CLEAN_STOP_MS);
        const force = setTimeout(() => current.kill("SIGKILL"), CLEAN_STOP_MS + 5000);
        current.once("exit", () => {
          clearTimeout(kill);
          clearTimeout(force);
          close();
        });
        current.stdin?.end();
      });
      return stopping;
    },
  };
}

/** Waits until the core answers, or gives up. */
export async function waitUp(url: string, ms = READY_MS): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await isUp(url)) return true;
    // Another program holds the port: no point waiting the full time for a core that cannot start.
    if (portProblem(url)) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function readBuild(root: string): { version?: string; sha?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "build.json"), "utf8")) as { version?: string; sha?: string };
  } catch {
    return {};
  }
}

/**
 * After core.env changes the core must start again. Ours is stopped (connector starts it again); an adopted one
 * belongs to the service, so the service is restarted, or the owner is told how in plain words (ADOPTAR-CORE-1).
 */
export async function restartForCoreEnv(
  core: EmbeddedCore,
  url: string,
  restartService: () => Promise<{ ok: boolean }>,
  es: boolean,
  waitMs = 10_000,
): Promise<{ restarted: "own" | "service" } | { error: string }> {
  if (!core.adopted()) {
    await core.stop();
    const until = Date.now() + waitMs;
    while (Date.now() < until && (await isUp(url))) await new Promise((r) => setTimeout(r, 200));
    return { restarted: "own" };
  }
  if ((await restartService()).ok) return { restarted: "service" };
  return {
    error: es
      ? "Colonia funciona como servicio en este equipo y no se pudo reiniciar para aplicar el cambio. Reinicia el equipo, o abre una terminal y escribe: colonia service restart"
      : "Colonia runs as a service on this computer and could not be restarted to apply the change. Restart the computer, or open a terminal and type: colonia service restart",
  };
}
