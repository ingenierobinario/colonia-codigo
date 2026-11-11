import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createSecrets } from "./secrets.ts";
import { type Run, secretServiceStore } from "./secrets-stores.ts";
import { tempDir } from "./testkit/platform.ts";

const timedOut = () => Object.assign(new Error("spawnSync secret-tool ETIMEDOUT"), { code: "ETIMEDOUT" });

test("a keyring that does not answer is left alone for a minute instead of blocking every read", () => {
  let calls = 0;
  let clock = 1000;
  let answers = false;
  const run: Run = (_cmd, args, o) => {
    calls++;
    assert.ok((o?.timeoutMs ?? 0) <= 15_000);
    if (!answers) throw timedOut();
    return args[0] === "lookup" ? "value\n" : "";
  };
  const store = secretServiceStore("colonia-test", run, () => clock);
  assert.equal(store.get("a"), undefined);
  assert.equal(store.get("b"), undefined);
  assert.throws(() => store.set("a", "v"), /not answering/);
  assert.equal(calls, 1, "after one timeout nothing else waits on the keyring");
  answers = true;
  clock += 59_000;
  assert.equal(store.get("a"), undefined);
  clock += 2000;
  assert.equal(store.get("a"), "value");
  assert.equal(calls, 2);
});

test("a keyring that fails at once keeps being asked: only waiting is rationed", () => {
  let calls = 0;
  const run: Run = () => {
    calls++;
    throw new Error("not found");
  };
  const store = secretServiceStore("colonia-test", run, () => 0);
  store.get("a");
  store.get("a");
  assert.equal(calls, 2);
  assert.equal(store.works(), false);
});

test("reading waits less than storing, which may need the person to unlock the keyring", () => {
  const waits: Record<string, number | undefined> = {};
  const run: Run = (_cmd, args, o) => {
    waits[args[0] as string] = o?.timeoutMs;
    return "";
  };
  const store = secretServiceStore("colonia-test", run);
  store.get("a");
  store.set("a", "v");
  assert.ok((waits.lookup ?? 0) < (waits.store ?? 0));
});

test("without a keyring the owner is told where the values are, and the file is theirs alone", async () => {
  await using dir = tempDir("colonia-secrets-file-");
  const file = path.join(dir.path, "secrets.json");
  fs.writeFileSync(file, JSON.stringify({ old: { value: "v", updated_at: "x" } }), { mode: 0o644 });
  const none: Run = () => {
    throw new Error("Cannot autolaunch D-Bus without X11 $DISPLAY");
  };
  const s = createSecrets(dir.path, "secret-service", {}, none);
  assert.equal(s.backend, "file");
  assert.match(s.notice ?? "", /No system keyring answered/);
  assert.ok(s.notice?.includes(file));
  assert.equal(s.resolve("secret://old"), "v");
  // Windows has no such bits; there the home folder's own access list does this.
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(createSecrets(dir.path, "file", {}, none).notice, undefined, "a file that was asked for is no news");
});

test("with a keyring there is nothing to tell", async () => {
  await using dir = tempDir("colonia-secrets-ring-");
  const kept = new Map<string, string>();
  const ring: Run = (_cmd, args, o) => {
    const key = args.at(-1) as string;
    if (args[0] === "store") kept.set(key, o?.input ?? "");
    if (args[0] === "clear") kept.delete(key);
    if (args[0] === "lookup") {
      if (!kept.has(key)) throw new Error("not found");
      return kept.get(key) as string;
    }
    return "";
  };
  assert.equal(createSecrets(dir.path, "secret-service", {}, ring).notice, undefined);
});
