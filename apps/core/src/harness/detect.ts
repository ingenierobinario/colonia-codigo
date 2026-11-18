// Which engines can run a turn on this machine: installed → logged in. Login is asked to each CLI itself;
// Colonia never reads, copies or refreshes their tokens.

import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { envOf, findCommand, findProgram, isWindowsShim, spawnable } from "../programs.ts";
import { childEnv } from "./env.ts";

const run = promisify(execFile);

async function cli(cmd: string, args: string[], env: NodeJS.ProcessEnv = childEnv()): Promise<string | undefined> {
  const reply = await answer(cmd, args, env);
  return reply.exitCode === 0 ? reply.out : undefined;
}

/** Solo se muestra el número de versión que reconoce el programa. */
export async function probeCliVersion(cmd: string): Promise<string | undefined> {
  const output = await cli(cmd, ["--version"]);
  return output?.match(
    /^(?:codex-cli[ \t]+)?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?:[ \t]+\(Claude Code\))?$/i,
  )?.[1];
}

/**
 * SESION-CODEX-1: what a CLI said, and whether it said anything at all. A CLI that answers with an exit code other
 * than 0 still answered (`codex login status` exits 1 when signed out); one that timed out, could not start or said
 * nothing did not, and that is not the same as "signed out".
 */
async function answer(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = childEnv(),
  timeout = 15_000,
): Promise<{ out?: string; failed: boolean; exitCode?: number }> {
  // On Windows an npm-installed CLI is a .cmd shim: what it starts is run instead.
  const start = spawnable(cmd, args);
  if (!start) return { failed: true };
  try {
    // Some CLIs (codex login status) answer on stderr.
    const { stdout, stderr } = await run(start.file, start.args, {
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      // What an agent's CLI gets: a script that starts with "env node" needs the owner's PATH to find Node.
      env,
    });
    const out = stdout.trim() || stderr.trim() || undefined;
    return out ? { out, failed: false, exitCode: 0 } : { failed: true };
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string | null; code?: unknown; stdout?: string; stderr?: string };
    const out = (e.stdout ?? "").trim() || (e.stderr ?? "").trim() || undefined;
    // Killed by the timeout or never started: no answer, whatever it printed so far.
    if (e.killed || e.signal || typeof e.code !== "number" || !out) return { failed: true };
    return { out, failed: false, exitCode: e.code };
  }
}

/** Two tries, the second with more time: a cold start on Windows can take longer than the first allows. */
async function patient(cmd: string, args: string[]) {
  const first = await answer(cmd, args);
  return first.failed ? answer(cmd, args, childEnv(), 30_000) : first;
}

/** `codex login status`: signed in (any method), signed out, or no answer. */
export function codexLogin(out: string | undefined): boolean | undefined {
  if (!out) return undefined;
  if (/\bnot\s+logged\s+in\b|\blogged\s+out\b|\bnot\s+signed\s+in\b/i.test(out)) return false;
  if (/\blogged\s+in\b|\bsigned\s+in\b/i.test(out)) return true;
  return undefined;
}

/** Where `bin` is for a program started with `env`: the owner's PATH, not only the one this core was started with. */
export async function lookup(bin: string, env: NodeJS.ProcessEnv = childEnv()): Promise<string | undefined> {
  const dirs = envOf(env, "PATH") ?? "";
  // No which on Windows: the PATH and where installers put programs, a shim when no program starts by itself.
  if (process.platform === "win32") return findCommand(bin, dirs);
  // A core the desktop app or launchd started has only the system's PATH: look where owners install too.
  return (await cli("/usr/bin/which", [bin], env))?.split("\n")[0] || findProgram(bin, dirs);
}

const whichCache = new Map<string, { at: number; path: string | undefined }>();

/**
 * Absolute path of a binary on PATH (the owner's own install), cached for a minute. On Windows it may be a .cmd shim:
 * start it through `toSpawn`, or hand an SDK what `sdkPath` gives.
 */
export async function which(bin: string): Promise<string | undefined> {
  // A path names itself, when it is there.
  if (/[\\/]/.test(bin)) return fs.existsSync(bin) ? bin : undefined;
  const hit = whichCache.get(bin);
  if (hit && Date.now() - hit.at < 60_000) return hit.path;
  const found = await lookup(bin);
  whichCache.set(bin, { at: Date.now(), path: found });
  return found;
}

/** After installing a program: look for it again now, not in a minute. */
export function forgetWhich(bin: string): void {
  whichCache.delete(bin);
}

const UNSTARTABLE = "is a Windows script Colonia cannot start by itself; install the native executable";

/** Codex's native program, from the npm launcher script its shim starts: the SDK starts it without a shell. */
export function codexNative(launcher: string, arch: string = process.arch): string | undefined {
  const cpu = arch === "arm64" ? "aarch64" : "x86_64";
  const roots = [path.join(path.dirname(launcher), "..")];
  try {
    const pkg = `@openai/codex-win32-${arch === "arm64" ? "arm64" : "x64"}/package.json`;
    roots.unshift(path.dirname(createRequire(launcher).resolve(pkg)));
  } catch {}
  for (const root of roots)
    for (const sub of [["bin"], ["codex"]]) {
      const exe = path.join(root, "vendor", `${cpu}-pc-windows-msvc`, ...sub, "codex.exe");
      if (fs.existsSync(exe)) return exe;
    }
  return undefined;
}

/**
 * The engine's program as its SDK wants it: one that starts without a shell. Behind a Windows .cmd shim that is the
 * native program the shim starts, or for Claude the script it runs with Node. Throws when the shim hides neither.
 */
export async function sdkPath(engine: "claude" | "codex", lookup = which): Promise<string | undefined> {
  const found = await lookup(engine);
  if (!found || !isWindowsShim(found)) return found;
  const start = spawnable(found);
  if (start && !start.args.length) return start.file;
  const script = start?.args.length === 1 && /^node(\.exe)?$/i.test(path.basename(start.file)) ? start.args[0] : "";
  const native = script && (engine === "claude" ? script : codexNative(script));
  if (!native) throw new Error(`${found} ${UNSTARTABLE}`);
  return native;
}

/** A shim nothing can be started from counts as not installed, with the reason for the owner to read. */
const unstartable = (bin: string): CliStatus | undefined =>
  spawnable(bin) ? undefined : { installed: false, logged_in: false, detail: `${bin} ${UNSTARTABLE}` };

/** `unsure`: the CLI did not answer (timeout, failed start): its session is unknown, not signed out. */
export type CliStatus = { installed: boolean; logged_in: boolean; version?: string; detail?: string; unsure?: boolean };

/**
 * SESION-CODEX-1: a check that got no answer never turns a signed-in engine into a signed-out one. It keeps the last
 * answer it had; with none yet it says it is still checking.
 */
export function settleStatus(next: CliStatus, last: CliStatus | undefined): CliStatus {
  if (!next.unsure) return next;
  if (last && !last.unsure && last.installed) return { ...last, ...(next.version ? { version: next.version } : {}) };
  return { ...next, logged_in: false, unsure: true };
}

export async function detectClaude(): Promise<CliStatus> {
  const bin = await which("claude");
  if (!bin) return { installed: false, logged_in: false };
  const broken = unstartable(bin);
  if (broken) return broken;
  const [version, auth] = await Promise.all([probeCliVersion(bin), patient(bin, ["auth", "status", "--json"])]);
  let logged: boolean | undefined;
  let detail: string | undefined;
  try {
    const a = JSON.parse(auth.out ?? "") as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    if (typeof a.loggedIn === "boolean") logged = a.loggedIn;
    detail = [a.authMethod, a.subscriptionType].filter(Boolean).join(" · ") || undefined;
  } catch {}
  return {
    installed: true,
    logged_in: logged === true,
    ...(logged === undefined ? { unsure: true } : {}),
    ...(version ? { version } : {}),
    ...(detail ? { detail } : {}),
  };
}

export async function detectCodex(): Promise<CliStatus> {
  const bin = await which("codex");
  if (!bin) return { installed: false, logged_in: false };
  const broken = unstartable(bin);
  if (broken) return broken;
  const [version, status] = await Promise.all([probeCliVersion(bin), patient(bin, ["login", "status"])]);
  const login = status.out;
  const logged = codexLogin(login);
  return {
    installed: true,
    logged_in: logged === true,
    ...(logged === undefined ? { unsure: true } : {}),
    ...(version ? { version } : {}),
    ...(login && logged ? { detail: login.replace(/^Logged in using\s*/i, "") } : {}),
  };
}
