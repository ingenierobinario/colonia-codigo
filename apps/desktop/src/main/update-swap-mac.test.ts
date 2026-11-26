import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { SWAP_MAC } from "./update-swap-mac.ts";

const run = promisify(execFile);
function fixture() {
  const dir = tempDir("mac-update-");
  const old = path.join(dir.path, "Colonia.app");
  const stage = path.join(dir.path, "stage");
  const next = path.join(stage, "Colonia.app");
  fs.mkdirSync(old);
  fs.mkdirSync(next, { recursive: true });
  fs.writeFileSync(path.join(old, "version"), "old");
  fs.writeFileSync(path.join(next, "version"), "new");
  return { old, stage, next, log: path.join(dir.path, "update.log") };
}

test("macOS swap keeps both versions intact when the app or a bundled process stays alive", async () => {
  if (process.platform === "win32") return;
  for (const parent of [true, false]) {
    const f = fixture();
    const commands = `kill() { return ${parent ? 0 : 1}; }; pgrep() { return 0; }; sleep() { :; };\n`;
    await assert.rejects(
      run("/bin/sh", ["-c", commands + SWAP_MAC, "swap-test", "999999", f.old, f.next, f.stage, "1", f.log]),
      (error: unknown) => (error as { code?: number }).code === 1,
    );
    assert.equal(fs.readFileSync(path.join(f.old, "version"), "utf8"), "old");
    assert.equal(fs.readFileSync(path.join(f.next, "version"), "utf8"), "new");
    assert.match(fs.readFileSync(f.log, "utf8"), /update postponed/);
  }
});

test("macOS swap opens the replacement before cleaning the previous installation", async () => {
  if (process.platform === "win32") return;
  const f = fixture();
  const commands = `
kill() { return 1; }; pgrep() { return 1; }
open() { [ "$(cat "$1/version")" = new ] || exit 2; echo opened >> "$log"; }
rm() { grep -q opened "$log" || exit 3; command rm "$@"; }
`;
  await run("/bin/sh", ["-c", commands + SWAP_MAC, "swap-test", "999999", f.old, f.next, f.stage, "1", f.log]);
  assert.equal(fs.readFileSync(path.join(f.old, "version"), "utf8"), "new");
  assert.equal(fs.existsSync(f.stage), false);
  assert.match(fs.readFileSync(f.log, "utf8"), /opened/);
});

test("macOS keeps the previous installation if reopening fails", async () => {
  if (process.platform === "win32") return;
  const f = fixture();
  const commands = "kill() { return 1; }; pgrep() { return 1; }; open() { return 1; };\n";
  await assert.rejects(
    run("/bin/sh", ["-c", commands + SWAP_MAC, "swap-test", "999999", f.old, f.next, f.stage, "1", f.log]),
    (error: unknown) => (error as { code?: number }).code === 1,
  );
  assert.equal(fs.readFileSync(path.join(f.old, "version"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(f.stage, "previous.app", "version"), "utf8"), "old");
});
