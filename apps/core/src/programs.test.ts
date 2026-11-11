import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nvmBin, withUsualDirs } from "./programs.ts";
import { tempDir } from "./testkit/platform.ts";

test("a bare PATH gets the usual folders it lacks at its end, only those that exist and once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-programs-"));
  const brew = path.join(root, "homebrew", "bin");
  const local = path.join(root, ".local", "bin");
  fs.mkdirSync(brew, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  const missing = path.join(root, "nowhere", "bin");
  try {
    const bare = ["/usr/bin", "/bin"].join(path.delimiter);
    assert.equal(withUsualDirs(bare, [brew, missing, local], "darwin"), [bare, brew, local].join(path.delimiter));
    // A folder already on the PATH keeps its place: the owner's order wins.
    const own = [local, "/usr/bin"].join(path.delimiter);
    assert.equal(withUsualDirs(own, [brew, local], "linux"), [own, brew].join(path.delimiter));
    assert.equal(withUsualDirs("", [brew], "darwin"), brew);
    // Windows' PATH is the user's own already.
    assert.equal(withUsualDirs(bare, [brew], "win32"), bare);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("nvm's programs are those of the newest Node it installed, compared as versions", async () => {
  await using dir = tempDir("colonia-nvm-");
  const home = dir.path;
  assert.equal(nvmBin(home), undefined, "no nvm, no folder");
  for (const v of ["v9.11.2", "v22.4.0", "v20.18.1", "system"])
    fs.mkdirSync(path.join(home, ".nvm", "versions", "node", v, "bin"), { recursive: true });
  assert.equal(nvmBin(home), path.join(home, ".nvm", "versions", "node", "v22.4.0", "bin"));
});
