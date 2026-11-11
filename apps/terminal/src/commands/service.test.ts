import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { waitFor } from "../../../core/src/testkit/platform.ts";
import { lastLines, logs, stopCore } from "./service.ts";
import { NODE_FLAGS, STOP_FILE, windowsRunCommand, windowsStopScript } from "./service-files.ts";
import { printed } from "./testing.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-logs-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

test("lastLines reads the end of a log, across read blocks, without a trailing empty line", () => {
  const file = path.join(home, "big.log");
  const all = Array.from({ length: 5000 }, (_, i) => `{"msg":"line ${i}","pad":"${"x".repeat(40)}"}`);
  fs.writeFileSync(file, `${all.join("\n")}\n`);
  assert.deepEqual(lastLines(file, 3), all.slice(-3));
  assert.deepEqual(lastLines(file, 2000), all.slice(-2000));
  fs.writeFileSync(file, "only\n");
  assert.deepEqual(lastLines(file, 100), ["only"]);
});

test("logs prints the last lines of <home>/logs/core.log and refuses a bad -n", async () => {
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  fs.writeFileSync(path.join(home, "logs", "core.log"), "a\nb\nc\n");
  assert.equal(await printed(() => logs(home, 2, false)), "b\nc");
  await assert.rejects(logs(home, 0, false), /-n is a number/);
});

test("stopCore ends the core, keeps its last output and closes the log, even if a grandchild holds its pipes", async () => {
  const file = path.join(home, "stop.log");
  const log = fs.createWriteStream(file, { flags: "a" });
  await once(log, "open");
  // The core ignores SIGTERM (stopCore must escalate) and leaves a grandchild holding stdout.
  const script = `
    const { spawn } = require("node:child_process");
    process.on("SIGTERM", () => {});
    const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: ["ignore", "inherit", "inherit"] });
    console.log("grandchild " + g.pid);
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const [line] = (await once(child.stdout, "data")) as [Buffer];
  const grandchild = Number(/grandchild (\d+)/.exec(String(line))?.[1]);
  try {
    const started = Date.now();
    await stopCore(child, log, 300);
    assert.ok(Date.now() - started < 5000);
    assert.notEqual(child.exitCode ?? child.signalCode, null);
    assert.ok(log.writableFinished);
    assert.match(fs.readFileSync(file, "utf8"), /grandchild \d+/);
  } finally {
    if (grandchild) {
      try {
        process.kill(grandchild);
      } catch (error) {
        // Windows may already have terminated the descendant with its parent.
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      }
    }
  }
});

test("stopCore with no core running only closes the log", async () => {
  const log = fs.createWriteStream(path.join(home, "idle.log"), { flags: "a" });
  await stopCore(undefined, log);
  assert.ok(log.writableFinished);
});

test("stopCore asks a core whose stdin it holds by closing it, so the core ends by itself", async () => {
  const file = path.join(home, "asked.log");
  const log = fs.createWriteStream(file, { flags: "a" });
  await once(log, "open");
  const script = `
    process.stdin.once("end", () => { console.log("closed cleanly"); clearInterval(busy); });
    process.stdin.resume();
    const busy = setInterval(() => {}, 1000);
    console.log("up");`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  await once(child.stdout, "data");
  await stopCore(child, log, 20_000);
  assert.equal(child.exitCode, 0, "ended by itself, not by a kill");
  assert.match(fs.readFileSync(file, "utf8"), /closed cleanly/);
});

// The real stop script against stand-ins with the registered command line: PowerShell exists only on Windows.
for (const obeys of process.platform === "win32" ? [true, false] : []) {
  test(`the Windows stop ${obeys ? "lets a supervisor that takes the stop file close its core" : "ends by force a supervisor that ignores the stop file"}`, async () => {
    const root = fs.mkdtempSync(path.join(home, "stop "));
    const data = path.join(root, "home");
    const terminal = path.join(root, "apps", "terminal", "src", "main.ts");
    const core = path.join(root, "apps", "core", "src", "main.ts");
    for (const dir of [data, path.dirname(terminal), path.dirname(core)]) fs.mkdirSync(dir, { recursive: true });
    const mark = (name: string) => path.join(data, name);
    fs.writeFileSync(
      core,
      `import fs from "node:fs";
      const busy = setInterval(() => {}, 1000);
      process.stdin.once("end", () => { fs.writeFileSync(${JSON.stringify(mark("core-closed"))}, ""); clearInterval(busy); });
      process.stdin.resume();
      fs.writeFileSync(${JSON.stringify(mark("up"))}, String(process.pid));`,
    );
    fs.writeFileSync(
      terminal,
      `import { spawn } from "node:child_process";
      import fs from "node:fs";
      const child = spawn(process.execPath, [...${JSON.stringify(NODE_FLAGS)}, ${JSON.stringify(core)}], { stdio: ["pipe", "ignore", "ignore"] });
      const ask = ${JSON.stringify(path.join(data, STOP_FILE))};
      const watch = setInterval(() => {
        if (!${obeys} || !fs.existsSync(ask)) return;
        fs.rmSync(ask);
        clearInterval(watch);
        child.stdin.end();
      }, 100);`,
    );
    const command = windowsRunCommand({ node: process.execPath, terminal, home: data, electron: false });
    const supervisor = spawn(process.execPath, [...NODE_FLAGS, terminal, "service", "run", "--home", data], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await waitFor(() => fs.existsSync(mark("up")) && fs.readFileSync(mark("up"), "utf8"), "the core", { ms: 20_000 });
      const corePid = Number(fs.readFileSync(mark("up"), "utf8"));
      fs.writeFileSync(path.join(data, STOP_FILE), "");
      execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", windowsStopScript(data, command)], {
        windowsHide: true,
      });
      // The script ran synchronously: the exit it caused is reported on the next turns of the loop.
      await waitFor(() => supervisor.exitCode !== null || supervisor.signalCode !== null, "the supervisor's end");
      assert.throws(() => process.kill(corePid, 0), "the core is gone");
      if (obeys) assert.ok(fs.existsSync(mark("core-closed")), "the core closed by itself");
    } finally {
      supervisor.kill();
    }
  });
}

test("on Windows only an exact home supervisor and its child core may be stopped", () => {
  const home = "C:\\Colonia's data\\v2";
  const command = windowsRunCommand({
    node: "C:\\Colonia\\node.exe",
    terminal: "C:\\Colonia\\apps\\terminal\\src\\main.ts",
    home,
    electron: false,
  });
  const script = windowsStopScript(home, command);
  assert.ok(script.includes("Colonia''s data"), "the exact home argument, quoted for PowerShell");
  assert.ok(script.includes("$parents -contains $_.ParentProcessId"), "only children of the selected supervisor");
  assert.ok(script.includes("$_.CommandLine -imatch"), "only complete command lines authorize a stop");
  assert.ok(!script.includes(".Contains("), "substrings never authorize a stop");
  assert.ok(!script.includes("service install"), "never the command that is running this");
  assert.match(script, /Wait-Process -Id \$ids -Timeout 10/);
});

// What older installs registered, settings and all: an upgrade still has to find and stop it.
const legacy = (line: string) =>
  `cmd /d /c "set COLONIA_PORT=7550&& set COLONIA_RELEASES=https://updates.example.com/feed&& ${line}"`;
for (const packaged of [false, true]) {
  for (const shape of ["plain", "electron", "legacy"] as const) {
    {
      const electron = shape === "electron";
      {
        test(`Windows stop uses the registered command: packaged=${packaged}, shape=${shape}`, () => {
          const root = packaged ? "C:\\Program Files\\Colonia\\current" : "C:\\work\\colonia";
          const node = `${root}\\${electron ? "electron.exe" : "node.exe"}`;
          const terminal = `${root}\\apps\\terminal\\src\\main.ts`;
          const home = "C:\\Colonia's data\\v2";
          let command = windowsRunCommand({
            node,
            terminal,
            home,
            electron,
          });
          if (shape === "legacy") command = legacy(command);
          const script = windowsStopScript(home, command);
          const searchedCommand = /-ceq '((?:''|[^'])*)'/.exec(script)?.[1]?.replaceAll("''", "'");
          assert.equal(searchedCommand, command, "stop searches for exactly the registered line");
          const patterns = [...script.matchAll(/-imatch '((?:''|[^'])*)'/g)].map(
            (m) => new RegExp((m[1] as string).replaceAll("''", "'"), "i"),
          );
          assert.equal(patterns.length, 2);
          const supervisor = windowsRunCommand({ node, terminal, home, electron: false });
          assert.match(supervisor, patterns[0] as RegExp);
          assert.doesNotMatch(`${supervisor} --extra`, patterns[0] as RegExp);
          assert.doesNotMatch(supervisor.replace("service run", "service install"), patterns[0] as RegExp);
          assert.doesNotMatch(supervisor.replace(home, `${home}-other`), patterns[0] as RegExp);
          const core = `"${node}" ${NODE_FLAGS.join(" ")} "${root}\\apps\\core\\src\\main.ts"`;
          assert.match(core, patterns[1] as RegExp);
          assert.doesNotMatch(`${core} --extra`, patterns[1] as RegExp);
          if (packaged) assert.ok(script.includes("current"));
        });
      }
    }
  }
}

test("Windows stop refuses unknown commands and entries registered for another home", () => {
  const command = windowsRunCommand({
    node: "C:\\Colonia\\node.exe",
    terminal: "C:\\Colonia\\apps\\terminal\\src\\main.ts",
    home: "C:\\data\\one",
    electron: false,
  });
  assert.throws(() => windowsStopScript("C:\\data\\two", command), /no process was stopped/);
  assert.throws(() => windowsStopScript("C:\\data\\one", "node anything"), /no process was stopped/);
});
