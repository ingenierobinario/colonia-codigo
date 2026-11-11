import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopOps } from "./desktop.ts";

type Call = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv };

function recorder(platform: NodeJS.Platform) {
  const calls: Call[] = [];
  const ops = desktopOps(platform, async (cmd, args, env) => {
    calls.push({ cmd, args, env });
  });
  return { ops, calls };
}

test("windows open: the path travels by environment, never on a command line cmd could read", async () => {
  const { ops, calls } = recorder("win32");
  const abs = "C:\\w\\R&D\\100%done\\a&calc&b [1].txt";
  await ops.open(abs);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c?.cmd, "powershell.exe");
  assert.ok(c?.args.every((a) => !a.includes(abs) && !a.includes("calc")));
  assert.equal(c?.env?.COLONIA_OPEN_PATH, abs);
  assert.match(c?.args.at(-1) ?? "", /ShellExecute\(\$env:COLONIA_OPEN_PATH\)/);
});

test("windows trash: a literal path, so [ ] in a folder name are not wildcards", async () => {
  const { ops, calls } = recorder("win32");
  await ops.trash("C:\\w\\data[1]");
  const [c] = calls;
  assert.equal(c?.cmd, "powershell.exe");
  assert.match(c?.args.at(-1) ?? "", /Test-Path -LiteralPath \$p -PathType Container/);
  assert.ok(c?.args.every((a) => !a.includes("data[1]")));
  assert.equal(c?.env?.COLONIA_TRASH_PATH, "C:\\w\\data[1]");
});

test("mac and linux keep their commands", async () => {
  const mac = recorder("darwin");
  await mac.ops.open("/u/a b.md");
  await mac.ops.reveal("/u/a b.md");
  await mac.ops.trash("/u/a b.md");
  assert.deepEqual(
    mac.calls.map((c) => [c.cmd, c.args[0], c.args.at(-1)]),
    [
      ["open", "/u/a b.md", "/u/a b.md"],
      ["open", "-R", "/u/a b.md"],
      ["osascript", "-e", "/u/a b.md"],
    ],
  );
  const linux = recorder("linux");
  await linux.ops.open("/u/a.md");
  await linux.ops.reveal("/u/a.md");
  await linux.ops.trash("/u/a.md");
  assert.deepEqual(
    linux.calls.map((c) => [c.cmd, ...c.args]),
    [
      ["xdg-open", "/u/a.md"],
      ["xdg-open", "/u"],
      ["gio", "trash", "/u/a.md"],
    ],
  );
});
