import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent } from "@colonia/protocol";
import { createBus } from "../bus.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { quoteArg } from "./pty-host.ts";
import { type CommandEnded, createTerminals } from "./terminals.ts";

const SIZE = { cols: 80, rows: 24 };
const WIN = process.platform === "win32";

function setup(o: Partial<Parameters<typeof createTerminals>[0]> = {}) {
  const bus = createBus();
  const events: CoreEvent[] = [];
  bus.on((e) => events.push(e));
  const ended: CommandEnded[] = [];
  const terminals = createTerminals({ bus, commandEnded: (e) => ended.push(e), ...o });
  const exited = (id: string) =>
    waitFor(() => events.find((e) => e.type === "terminal.exited" && e.terminal === id), `terminal ${id} to end`, {
      ms: 15_000,
    });
  return { terminals, events, ended, exited };
}

/** Runs with SHELL pointing at Node, which names the option it was given ("bad option: -l") and ends. */
async function withNodeAsShell<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.SHELL;
  process.env.SHELL = process.execPath;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.SHELL;
    else process.env.SHELL = before;
  }
}

test("Windows opens its terminal on the native pty and never looks for Python", async () => {
  await using dir = tempDir();
  let probed = false;
  const { terminals, exited } = setup({
    platform: "win32",
    python: () => {
      probed = true;
      return "python3";
    },
    nativePty: () => true,
  });
  // A command block on win32 runs where agents' commands do; it ends by itself.
  const info = terminals.open("th_1", dir.path, SIZE, { command: "exit 0" });
  assert.equal(info.tty, true);
  assert.equal(probed, false);
  await exited(info.id);
  terminals.close(info.id);
});

test("a Unix without Python opens a login shell on the native pty", async () => {
  await using dir = tempDir();
  await withNodeAsShell(async () => {
    const { terminals, exited } = setup({ platform: "darwin", python: () => undefined, nativePty: () => true });
    const info = terminals.open("th_1", dir.path, SIZE);
    assert.equal(info.tty, true);
    await exited(info.id);
    assert.match(terminals.attach(info.id).backlog, /-l/);
    terminals.close(info.id);
  });
});

test("with neither Python nor a native pty the shell runs on pipes, interactive, and still answers", async () => {
  await using dir = tempDir();
  await withNodeAsShell(async () => {
    const { terminals, exited } = setup({ platform: "linux", python: () => undefined, nativePty: () => false });
    const info = terminals.open("th_1", dir.path, SIZE);
    assert.equal(info.tty, false);
    // Node takes -i too: it opens its prompt, which says what it was started with.
    terminals.input(info.id, 'console.log("args:" + process.execArgv.join(" "))\r.exit\r');
    await exited(info.id);
    assert.match(terminals.attach(info.id).backlog, /args:-i/);
    terminals.close(info.id);
  });
  const { terminals, exited } = setup({ python: () => undefined, nativePty: () => false });
  const info = terminals.open("th_1", dir.path, SIZE);
  assert.equal(info.tty, false);
  terminals.input(info.id, WIN ? "set /a 40+2\r" : "echo $((40+2))\r");
  await waitFor(() => terminals.attach(info.id).backlog.includes("42"), "the shell's answer", { ms: 15_000 });
  terminals.close(info.id);
  await exited(info.id);
});

test("an open terminal on the real native pty takes input, resizes and ends when closed", async () => {
  await using dir = tempDir();
  const { terminals, exited } = setup({ python: () => undefined });
  const info = terminals.open("th_1", dir.path, SIZE);
  assert.equal(info.tty, true, "the native pty loads on this machine");
  const backlog = () => terminals.attach(info.id).backlog;
  terminals.input(info.id, WIN ? "set /a 40+2\r" : "echo $((40+2))\r");
  await waitFor(() => /\b42\b/.test(backlog().replace(/40\+2/g, "")), "the shell's answer", { ms: 15_000 });
  terminals.resize(info.id, { cols: 117, rows: 31 });
  terminals.input(info.id, WIN ? "mode con\r" : "stty size\r");
  await waitFor(() => backlog().includes("117"), "the new width", { ms: 15_000 });
  terminals.close(info.id);
  await exited(info.id);
});

test("a command block on the native pty reports its exit code and output, quotes included", async () => {
  await using dir = tempDir();
  const { terminals, ended, exited } = setup({ python: () => undefined });
  const info = terminals.open("th_1", dir.path, SIZE, { command: 'echo block-out; "echo" "one  two"; exit 3' });
  assert.equal(info.tty, true);
  await exited(info.id);
  const done = await waitFor(() => ended.find((e) => e.info.id === info.id), "the command's end");
  assert.equal(done.info.exit_code, 3);
  assert.match(done.output, /block-out/);
  assert.match(done.output, /one {2}two/);
  terminals.close(info.id);
});

test("Windows arguments are quoted the way Node quotes them", () => {
  assert.equal(quoteArg("plain"), "plain");
  assert.equal(quoteArg(""), '""');
  assert.equal(quoteArg("one two"), '"one two"');
  assert.equal(quoteArg('"a b" "c"'), '"\\"a b\\" \\"c\\""');
  assert.equal(quoteArg("dir\\"), "dir\\");
  assert.equal(quoteArg("a b\\"), '"a b\\\\"');
  assert.equal(quoteArg('x\\"y'), '"x\\\\\\"y"');
});
