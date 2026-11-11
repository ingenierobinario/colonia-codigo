import path from "node:path";
import type { Log } from "../log.ts";
import { withUsualDirs } from "../programs.ts";
import { createLoginEnv, type LoginEnv, mergeShell } from "./login-env.ts";

/** The folder of the core's own `colonia` launcher (harness/colonia-command.ts), set once the core listens. */
let commandBin: string | undefined;

/** Whether agents' PATH gets the usual program folders: only for a core the desktop app or a service started. */
let usualDirs = false;

/** Where what the owner's login shell exports is taken from: only for such a core too. */
let ownerShell: LoginEnv | undefined;
/** The real one, asked once however many cores this process starts; it tells the latest core's log. */
let realShell: LoginEnv | undefined;
let shellLog: Log | undefined;

/** A supervised core (desktop app, launchd, systemd) got the system's bare PATH; one started by hand keeps its own. */
export function useUsualDirs(on: boolean): void {
  usualDirs = on;
}

/**
 * A supervised core got nothing of what its owner's shell exports either (proxies, certificates, the folders of
 * version managers): their login shell is asked for it, now and without waiting. `shell` stands in for the real one.
 */
export function useOwnerShell(on: boolean, o: { log?: Log; shell?: LoginEnv } = {}): void {
  shellLog = o.log;
  if (on && !o.shell)
    realShell ??= createLoginEnv({
      // Names only: a proxy's address can carry a password.
      read: (shell, names) => shellLog?.info({ shell, names }, "owner's shell environment read"),
      failed: (shell, err) => shellLog?.warn({ shell, err }, "owner's shell environment not read"),
    });
  ownerShell = on ? (o.shell ?? realShell) : undefined;
  ownerShell?.ask();
}

/** Puts this core's `colonia` first on the PATH of everything agents run; undefined takes it off. */
export function useColoniaCommand(bin: string | undefined): void {
  commandBin = bin;
}

/** Adds what the owner's shell exports and `env` lacks, once it has answered; a read that failed is tried again here. */
function addOwnerShell(env: Record<string, string | undefined>): void {
  ownerShell?.ask();
  const shell = ownerShell?.current();
  if (shell) mergeShell(env, shell);
}

/** `env` with what the owner's login shell exports and it lacks: what a terminal the core opens starts from. */
export function withOwnerShell(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  addOwnerShell(out);
  return out;
}

/**
 * An agent CLI (Claude Code, Codex, an ACP agent) gets the environment minus Colonia's own secrets, with this core's `colonia`
 * first on its PATH and, for a supervised core, what the owner's shell exports (its PATH, proxies, certificates) and
 * the usual program folders (Homebrew, ~/.local/bin) its PATH still lacks.
 */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("COLONIA_")) env[k] = v;
  addOwnerShell(env);
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const own = env[key] ?? "";
  env[key] = [commandBin, usualDirs ? withUsualDirs(own) : own].filter(Boolean).join(path.delimiter);
  return env;
}

/** Variable names that usually hold credentials. */
export const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE)/i;

/**
 * A command an agent runs gets less: no credentials at all. Agent CLIs may need their own keys; a shell command
 * started by a model must not be able to print them.
 */
export function commandEnv(): Record<string, string> {
  const env = childEnv();
  for (const k of Object.keys(env)) if (SECRET_NAME.test(k)) delete env[k];
  return { ...NO_PROMPTS, ...env };
}

/**
 * Nobody answers an agent's command: tools that would prompt take their default instead of aborting on a missing TTY
 * (pnpm purging node_modules, git asking for a password or an editor, npx asking to install). pnpm skips its purge
 * question only in CI mode, so it gets that alone, with the lockfile still updatable; a plain `CI=true` would change
 * what every other build and test runner does. The owner's own values win.
 */
const NO_PROMPTS: Readonly<Record<string, string>> = {
  pnpm_config_ci: "true",
  pnpm_config_frozen_lockfile: "false",
  npm_config_yes: "true",
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_PAGER: "cat",
  PAGER: "cat",
};

/**
 * An agent harness process (Claude Code, Codex): the environment minus Colonia's own secrets, and who is calling; `agent`
 * marks its own commands as an agent's (COLONIA_AGENT), as ours are.
 */
export function harnessEnv(agent?: string): Record<string, string> {
  return { ...childEnv(), CLAUDE_AGENT_SDK_CLIENT_APP: "colonia/2", ...(agent ? { COLONIA_AGENT: agent } : {}) };
}
