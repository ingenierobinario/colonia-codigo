import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claudeLogin } from "./claude-login.ts";
import { fakeProgram } from "./fake-program.test-support.ts";

const PROMPT =
  "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\nPaste code here if prompted > ";

// A stand-in `claude`: `auth status` reads a state file, `auth login` prints Claude's page and waits for the code.
function fakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-claude-login-"));
  const state = path.join(dir, "state.json").split(path.sep).join("/");
  const prog = fakeProgram(
    dir,
    "claude",
    `const fs = require("node:fs");
const [sub, cmd] = argv[0] === "auth" ? argv.slice(0, 2) : argv.slice(1, 3);
const st = fs.existsSync("${state}") ? JSON.parse(fs.readFileSync("${state}", "utf8")) : { loggedIn: false };
if (cmd === "status") { process.stdout.write(JSON.stringify(st)); }
else if (cmd === "logout") { fs.writeFileSync("${state}", JSON.stringify({ loggedIn: false })); }
else if (cmd === "login") {
  process.stdout.write(${JSON.stringify(PROMPT)});
  process.stdin.once("data", (b) => {
    if (b.toString().trim() === "good") fs.writeFileSync("${state}", JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "a@b.c", subscriptionType: "max" }));
    process.exit(b.toString().trim() === "good" ? 0 : 1);
  });
}`,
  );
  Object.assign(process.env, prog.env);
  return { bin: prog.bin, dir };
}

test("signs the Claude plan in through Claude Code's own sign-in, with the code Claude's page shows", async () => {
  const { bin, dir } = fakeClaude();
  let changed = 0;
  const login = claudeLogin({ find: async () => bin, onChange: () => changed++ });
  assert.deepEqual(await login.status(), { installed: true, connected: false });
  const started = await login.start();
  assert.match(started.pending?.url ?? "", /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
  const done = await login.code("good");
  assert.equal(done.connected, true);
  assert.equal(done.account, "a@b.c");
  assert.equal(done.plan, "max");
  assert.equal(done.pending, undefined);
  assert.ok(changed >= 1);
  const out = await login.disconnect();
  assert.equal(out.connected, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a refused code ends the sign-in with the reason, and no Claude Code says so", async () => {
  const { bin, dir } = fakeClaude();
  const login = claudeLogin({ find: async () => bin });
  await login.start();
  const refused = await login.code("bad");
  assert.equal(refused.connected, false);
  assert.equal(refused.pending, undefined);
  assert.ok(refused.error);
  assert.deepEqual(await claudeLogin({ find: async () => undefined }).status(), { installed: false, connected: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
