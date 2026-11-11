import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { removeDir } from "../testkit/platform.ts";
import { childEnv, commandEnv, useColoniaCommand, useOwnerShell, useUsualDirs, withOwnerShell } from "./env.ts";
import type { LoginEnv } from "./login-env.ts";

const run = promisify(execFile);

test("an agent's command is told nobody answers prompts, and the owner's own values win", (t) => {
  const own = process.env.GIT_PAGER;
  process.env.GIT_PAGER = "less";
  t.after(() => {
    if (own === undefined) delete process.env.GIT_PAGER;
    else process.env.GIT_PAGER = own;
  });
  const env = commandEnv();
  assert.equal(env.pnpm_config_ci, "true");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.npm_config_yes, "true");
  assert.equal(env.GIT_PAGER, "less");
  assert.equal(env.CI, process.env.CI, "CI is left as the core found it");
});

test("pnpm run by an agent reinstalls a changed node_modules instead of aborting for a missing terminal", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-env-"));
  t.after(() => removeDir(dir));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" }));
  const manifest = (deps: Record<string, string>) =>
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }),
    );
  const env = commandEnv();
  const pnpm = (store: string) =>
    run("pnpm", ["install", "--store-dir", path.join(dir, store)], {
      cwd: dir,
      env,
      timeout: 60_000,
      shell: process.platform === "win32",
    });
  manifest({ lib: "file:./lib" });
  await pnpm("store-a");
  // Another store makes pnpm purge node_modules, which it asks first; a new dependency needs the lockfile to change.
  manifest({ lib: "file:./lib", other: "file:./lib" });
  await pnpm("store-b");
  assert.ok(fs.existsSync(path.join(dir, "node_modules", "other")));
});

/** An owner's shell that has already answered with `env`, and how often it was asked. */
function answered(env: Record<string, string> | undefined) {
  const shell = { asked: 0, ask: () => void shell.asked++, current: () => env, settled: async () => {} };
  return shell satisfies LoginEnv & { asked: number };
}

/** The core's own environment for one test: only `own`, put back as it was afterwards, with every hook off. */
function coreEnv(t: { after: (fn: () => void) => void }, own: Record<string, string>) {
  const before = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, own);
  t.after(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, before);
    useOwnerShell(false);
    useColoniaCommand(undefined);
    useUsualDirs(false);
  });
}

const dirs = (...list: string[]) => list.join(path.delimiter);

test("what agents run gets what the owner's shell exports and the core lacks, the core's own values first", (t) => {
  coreEnv(t, { PATH: dirs("/usr/bin", "/bin"), LANG: "C", COLONIA_HOME: "/home/owner/.colonia" });
  const shell = answered({
    PATH: dirs("/opt/homebrew/bin", "/usr/bin", "/bin"),
    HTTPS_PROXY: "http://proxy.example:8080",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/acme.pem",
    LANG: "es_ES.UTF-8",
  });
  useOwnerShell(true, { shell });
  useColoniaCommand("/home/owner/.colonia/bin");
  const env = childEnv();
  assert.equal(env.PATH, dirs("/home/owner/.colonia/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"));
  assert.equal(env.HTTPS_PROXY, "http://proxy.example:8080");
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/etc/ssl/acme.pem");
  assert.equal(env.LANG, "C");
  assert.equal(env.COLONIA_HOME, undefined);
  assert.equal(commandEnv().HTTPS_PROXY, "http://proxy.example:8080", "an agent's command is behind the proxy too");
});

test("a core started by hand, or whose owner's shell has not answered, gives agents its own environment", (t) => {
  coreEnv(t, { PATH: dirs("/usr/bin", "/bin") });
  const silent = answered(undefined);
  useOwnerShell(true, { shell: silent });
  assert.deepEqual(childEnv(), { PATH: dirs("/usr/bin", "/bin") });
  childEnv();
  // Each start of a program asks again: that is what retries a shell that failed to answer.
  assert.equal(silent.asked, 3);
  const shell = answered({ PATH: dirs("/opt/homebrew/bin"), HTTPS_PROXY: "http://proxy.example:8080" });
  useOwnerShell(true, { shell });
  assert.equal(childEnv().HTTPS_PROXY, "http://proxy.example:8080");
  useOwnerShell(false);
  assert.deepEqual(childEnv(), { PATH: dirs("/usr/bin", "/bin") });
  assert.equal(shell.asked, 2, "not asked once the core is not supervised");
});

test("a terminal the core opens starts from the owner's shell exports too, and the core's environment is untouched", (t) => {
  coreEnv(t, { PATH: dirs("/usr/bin") });
  useOwnerShell(true, {
    shell: answered({ PATH: dirs("/opt/homebrew/bin", "/usr/bin"), NVM_DIR: "/home/owner/.nvm" }),
  });
  useColoniaCommand("/home/owner/.colonia/bin");
  const own = { PATH: dirs("/usr/bin"), EDITOR: "vi" };
  assert.deepEqual(withOwnerShell(own), {
    PATH: dirs("/opt/homebrew/bin", "/usr/bin"),
    EDITOR: "vi",
    NVM_DIR: "/home/owner/.nvm",
  });
  assert.deepEqual(own, { PATH: dirs("/usr/bin"), EDITOR: "vi" });
  assert.equal(process.env.NVM_DIR, undefined);
});
