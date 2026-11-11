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
  try {
    // On Windows an npm-installed CLI is a .cmd shim: what it starts is run instead.
    const start = spawnable(cmd, args);
    if (!start) return undefined;
    // Some CLIs (codex login status) answer on stderr.
    const { stdout, stderr } = await run(start.file, start.args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      // What an agent's CLI gets: a script that starts with "env node" needs the owner's PATH to find Node.
      env,
    });
    return stdout.trim() || stderr.trim() || undefined;
  } catch {
    return undefined;
  }
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

export type CliStatus = { installed: boolean; logged_in: boolean; version?: string; detail?: string };

export async function detectClaude(): Promise<CliStatus> {
  const bin = await which("claude");
  if (!bin) return { installed: false, logged_in: false };
  const broken = unstartable(bin);
  if (broken) return broken;
  const [version, auth] = await Promise.all([cli(bin, ["--version"]), cli(bin, ["auth", "status", "--json"])]);
  let logged = false;
  let detail: string | undefined;
  try {
    const a = JSON.parse(auth ?? "{}") as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    logged = Boolean(a.loggedIn);
    detail = [a.authMethod, a.subscriptionType].filter(Boolean).join(" · ") || undefined;
  } catch {}
  return {
    installed: true,
    logged_in: logged,
    ...(version ? { version: version.split(" ")[0] } : {}),
    ...(detail ? { detail } : {}),
  };
}

export async function detectCodex(): Promise<CliStatus> {
  const bin = await which("codex");
  if (!bin) return { installed: false, logged_in: false };
  const broken = unstartable(bin);
  if (broken) return broken;
  const [version, login] = await Promise.all([cli(bin, ["--version"]), cli(bin, ["login", "status"])]);
  return {
    installed: true,
    logged_in: /logged in/i.test(login ?? ""),
    ...(version ? { version: version.replace(/^codex-cli\s*/, "") } : {}),
    ...(login ? { detail: login.replace(/^Logged in using\s*/i, "") } : {}),
  };
}
