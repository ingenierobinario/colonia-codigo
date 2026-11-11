// What the owner's shell exports, for a core nobody started from a terminal. The desktop app, launchd and systemd hand
// it the system's bare PATH and nothing of ~/.zshrc or ~/.profile (proxies, certificates, version managers), so what
// agents run would not behave as in the owner's terminal. Their login shell is asked once, in the background; a shell
// that fails or takes too long changes nothing.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "../errors.ts";

/** Runs the shell and settles with what it wrote to stdout; rejects when it cannot start or outlasts `timeoutMs`. */
export type ShellRun = (
  file: string,
  args: string[],
  o: { env: Record<string, string>; timeoutMs: number },
) => Promise<string>;

/** rc files slower than this are given up on (a prompt nobody answers, a network mount). */
const TIMEOUT_MS = 10_000;
/** A failed read is tried again this much later: a machine busy starting is not a broken shell. */
const RETRY_AFTER_MS = 60_000;
const MAX_TRIES = 3;
const MAX_OUTPUT = 4 * 1024 * 1024;

/**
 * Besides PATH, what agents' programs take from the shell: how to reach the network and where the owner's tools keep
 * their files. Never credentials, and nothing the core reads for itself (CLAUDE_CONFIG_DIR, CODEX_HOME): its agents
 * would then look in another place than it does.
 */
const TAKEN: ReadonlySet<string> = new Set([
  ...["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"].flatMap((k) => [k, k.toLowerCase()]),
  ...["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"],
  ...["LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME"],
  ...["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"],
  ...["NVM_DIR", "VOLTA_HOME", "BUN_INSTALL", "PNPM_HOME", "FNM_DIR", "ASDF_DIR", "ASDF_DATA_DIR", "MISE_DATA_DIR"],
  ...["PYENV_ROOT", "RBENV_ROOT", "GOPATH", "GOROOT", "GOBIN", "CARGO_HOME", "RUSTUP_HOME", "DENO_INSTALL"],
  ...["JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "HOMEBREW_REPOSITORY"],
]);

/** An account that cannot log in (a service's own user) has no shell to ask. */
const NO_SHELL = /(^|\/)(nologin|false)$/;

/** Safe as one word in sh, bash, zsh, fish and csh. */
const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The command the shell runs: this same Node prints the environment the shell gave it, as JSON between two marks, so
 * whatever rc files print stays outside and a value with line breaks stays whole. The app's own binary answers as
 * Node; NODE_OPTIONS an rc file exports is left out of that run (the app's Node does not take every option).
 */
export function dumpCommand(node: string, mark: string): string {
  const script = `"${mark}" + JSON.stringify(process.env) + "${mark}"`;
  return `/usr/bin/env -u NODE_OPTIONS ELECTRON_RUN_AS_NODE=1 ${quoted(node)} -p ${quoted(script)}`;
}

/** A login, interactive shell that runs one command and ends: what reads ~/.zprofile and ~/.zshrc, or their peers. */
export function dumpArgs(shell: string, command: string): string[] {
  // csh has no login flag beside a command: its interactive start reads ~/.cshrc, where its users export.
  return /^t?csh$/.test(path.basename(shell)) ? ["-ic", command] : ["-i", "-l", "-c", command];
}

/** The environment between the marks, or undefined when the shell did not print one whole. */
export function parseDump(out: string, mark: string): Record<string, string> | undefined {
  const from = out.indexOf(mark);
  const to = out.lastIndexOf(mark);
  if (from < 0 || to <= from) return undefined;
  try {
    const parsed: unknown = JSON.parse(out.slice(from + mark.length, to));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") env[k] = v;
    return env;
  } catch {
    return undefined;
  }
}

/** PATH and the variables taken, those the shell gave a value. */
export function takenFrom(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v && (k === "PATH" || TAKEN.has(k))) out[k] = v;
  return out;
}

/**
 * The shell's PATH in its order, after what only the core's own PATH has. Somebody put those there (a service's PATH
 * from the day it was installed, a wrapper's folder); an app opened from the Finder has none, and its agents get the
 * PATH of the owner's terminal.
 */
export function mergePath(own: string, shell: string, delimiter: string = path.delimiter): string {
  const theirs = shell.split(delimiter).filter(Boolean);
  const known = new Set(theirs);
  const mine = own.split(delimiter).filter((d) => d && !known.has(d));
  return [...new Set([...mine, ...theirs])].join(delimiter);
}

/** `env` plus what the shell exports and it lacks, under any case of the name: what the core was given wins. */
export function mergeShell(env: Record<string, string | undefined>, shell: Readonly<Record<string, string>>): void {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const have = new Set(Object.keys(env).map((k) => k.toUpperCase()));
  for (const [k, v] of Object.entries(shell)) if (k !== "PATH" && !have.has(k.toUpperCase())) env[k] = v;
  if (shell.PATH) env[key] = mergePath(env[key] ?? "", shell.PATH);
}

/** The shell this user logs in with: the session's, else the account's (not every service is given a SHELL). */
export function loginShell(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  account: () => string | null | undefined = () => os.userInfo().shell,
): string {
  if (env.SHELL) return env.SHELL;
  try {
    const shell = account();
    if (shell) return shell;
  } catch {}
  return platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

/** What the shell starts from: the core's environment without Colonia's own settings, as the owner's terminals get. */
function startEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env))
    if (v !== undefined && !k.startsWith("COLONIA_") && k !== "ELECTRON_RUN_AS_NODE" && k !== "NODE_OPTIONS")
      out[k] = v;
  return out;
}

/** Calls `fn` in `ms` and returns how to call that off; the default never holds the process open. */
export type After = (ms: number, fn: () => void) => () => void;

const unheld: After = (ms, fn) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * The real run, in a process group of its own: giving up also ends what rc files started, and no terminal is taken.
 * Nothing of it holds the core open, and a core that ends first takes the shell with it.
 */
export function shellRunner(after: After = unheld): ShellRun {
  return (file, args, o) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        env: o.env,
        stdio: ["ignore", "pipe", "ignore"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      let out = "";
      let done = false;
      // In one step, so it also works while the core exits.
      const kill = () => {
        if (child.pid === undefined) return;
        try {
          if (process.platform === "win32") child.kill();
          else process.kill(-child.pid, "SIGKILL");
        } catch {}
      };
      const end = (err?: Error) => {
        if (done) return;
        done = true;
        cancel();
        process.off("exit", kill);
        if (!err) return resolve(out);
        kill();
        reject(err);
      };
      const cancel = after(o.timeoutMs, () => end(new Error(`it did not answer in ${o.timeoutMs} ms`)));
      child.unref();
      (child.stdout as typeof child.stdout & { unref?: () => void }).unref?.();
      process.once("exit", kill);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (text: string) => {
        if (done) return;
        out += text;
        if (out.length > MAX_OUTPUT) end(new Error("it printed too much"));
      });
      child.on("error", end);
      child.on("close", () => end());
    });
}

export type LoginEnv = {
  /** Starts a read unless one is known, under way, too recent a failure or given up on. Returns at once, never throws. */
  ask(): void;
  /** What the shell exports of the variables taken, once a read has worked; nothing before, and never on Windows. */
  current(): Readonly<Record<string, string>> | undefined;
  /** Settles when the read under way has ended, whichever way. */
  settled(): Promise<void>;
};

export type LoginEnvDeps = {
  platform?: NodeJS.Platform;
  /** The core's own environment: where SHELL is read and what the shell starts from. */
  env?: NodeJS.ProcessEnv;
  shell?: string;
  /** The Node that prints the environment; the core's own. */
  node?: string;
  run?: ShellRun;
  now?: () => number;
  mark?: () => string;
  timeoutMs?: number;
  /** A read worked: the shell and the names it gave, never their values (a proxy's address can carry a password). */
  read?: (shell: string, names: string[]) => void;
  /** A read failed; agents keep the core's own environment. */
  failed?: (shell: string, why: string) => void;
};

export function createLoginEnv(deps: LoginEnvDeps = {}): LoginEnv {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const run = deps.run ?? shellRunner();
  let known: Record<string, string> | undefined;
  let reading: Promise<void> | undefined;
  let tries = 0;
  let failedAt = 0;

  async function read(shell: string, env: NodeJS.ProcessEnv): Promise<void> {
    const mark = deps.mark?.() ?? randomBytes(8).toString("hex");
    const command = dumpCommand(deps.node ?? process.execPath, mark);
    const out = await run(shell, dumpArgs(shell, command), {
      env: startEnv(env),
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    const all = parseDump(out, mark);
    if (!all) throw new Error("it did not print its environment");
    known = takenFrom(all);
    deps.read?.(shell, Object.keys(known));
  }

  return {
    ask() {
      if (platform === "win32" || known || reading || tries >= MAX_TRIES) return;
      if (tries > 0 && now() - failedAt < RETRY_AFTER_MS) return;
      const env = deps.env ?? process.env;
      const shell = deps.shell ?? loginShell(env, platform);
      if (NO_SHELL.test(shell)) {
        tries = MAX_TRIES;
        return;
      }
      tries++;
      reading = read(shell, env)
        .catch((err) => {
          failedAt = now();
          deps.failed?.(shell, errorMessage(err, 300));
        })
        .finally(() => {
          reading = undefined;
        });
    },
    current: () => known,
    settled: () => reading ?? Promise.resolve(),
  };
}
