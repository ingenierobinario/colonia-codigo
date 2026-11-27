import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { workspaceComputer, workspaceEnvironment } from "./environment.ts";

test("a business gets its own account directories and no inherited connection credentials", () => {
  const source = {
    PATH: "programs",
    SystemRoot: "system",
    OPENAI_API_KEY: "other-business",
    GH_TOKEN: "other-business",
    COLONIA_TOKEN: "owner",
    COLONIA_LLM_KEY: "provider",
    CODEX_HOME: "owner-codex",
    CLAUDE_CONFIG_DIR: "owner-claude",
    HOME: "owner-home",
    NODE_OPTIONS: "--require injected.cjs",
    HTTP_PROXY: "http://user:password@proxy",
    SSH_AUTH_SOCK: "owner-agent",
  };
  const a = workspaceEnvironment(source, path.resolve("business-a"), "token-a", "https://example.com/a", false);
  const b = workspaceEnvironment(source, path.resolve("business-b"), "token-b", "https://example.com/b", false);
  assert.equal(a.PATH, "programs");
  assert.equal(a.SystemRoot, "system");
  for (const key of ["OPENAI_API_KEY", "GH_TOKEN", "COLONIA_LLM_KEY", "NODE_OPTIONS", "HTTP_PROXY", "SSH_AUTH_SOCK"])
    assert.equal(a[key], undefined, key);
  assert.equal(a.COLONIA_TOKEN, "token-a");
  assert.equal(b.COLONIA_TOKEN, "token-b");
  for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "APPDATA", "LOCALAPPDATA", "TEMP"])
    assert.notEqual(a[key], b[key], key);
  assert.equal(source.HOME, "owner-home");
  assert.equal(a.COLONIA_RUNTIME_SKILLS, "off");
  assert.equal(a.COLONIA_SUPERVISED, undefined);
});

test("Electron workers explicitly run as Node without inheriting Electron settings", () => {
  const env = workspaceEnvironment(
    { ELECTRON_RUN_AS_NODE: "0", ELECTRON_ENABLE_LOGGING: "1" },
    "workspace",
    "key",
    "https://example.com",
    true,
  );
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.ELECTRON_ENABLE_LOGGING, undefined);
});

test("workers reuse only an explicit absolute application compile cache, without execution options", () => {
  const cache = path.resolve("application-cache");
  const env = workspaceEnvironment(
    { NODE_COMPILE_CACHE: cache, NODE_OPTIONS: "--require injected.cjs", OPENAI_API_KEY: "other-business" },
    path.resolve("business"),
    "key",
    "https://example.com",
    false,
  );
  assert.equal(env.NODE_COMPILE_CACHE, cache);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(
    workspaceEnvironment({ NODE_COMPILE_CACHE: "relative-cache" }, "business", "key", "https://example.com", false)
      .NODE_COMPILE_CACHE,
    undefined,
  );
});

test("business VMs have stable distinct OS distribution names, not the main computer's name", () => {
  const a = workspaceComputer(path.resolve("business-a"));
  const b = workspaceComputer(path.resolve("business-b"));
  assert.notEqual(a.instance, b.instance);
  assert.notEqual(a.instance, "computer");
  assert.equal(a.instance, workspaceComputer(path.resolve("business-a")).instance);
  assert.match(a.instance, /^[a-z0-9-]{1,40}$/);
  assert.notEqual(a.limaHome, b.limaHome);
});
