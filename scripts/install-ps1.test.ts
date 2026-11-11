import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";

const script = path.resolve(import.meta.dirname, "install/install.ps1");
// install.ps1 is the Windows installer; Linux and macOS run install.sh.
const windows = process.platform === "win32";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const shell = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

/** A bundle with what install.ps1 checks and the command starts: Node, and a terminal that says how it was called. */
function bundle(dir: string, version: string): string {
  const src = path.join(dir, `src-${version}`);
  const main = path.join(src, "colonia", "apps", "terminal", "src", "main.ts");
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.mkdirSync(path.join(src, "colonia", "node"), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(src, "colonia", "node", "node.exe"));
  fs.writeFileSync(
    main,
    `console.error("a warning on stderr");
    console.log(JSON.stringify({ version: ${JSON.stringify(version)}, app: process.env.COLONIA_APP, args: process.argv.slice(2) }));`,
  );
  const name = `colonia-core-${version}-win-${arch}.tar.gz`;
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-czf", name, "colonia"], {
    cwd: src,
  });
  return path.join(src, name);
}

test("the Windows installer is plain ASCII, so Windows PowerShell 5.1 reads it the same in every code page", () => {
  const bytes = fs.readFileSync(script);
  assert.equal(
    bytes.findIndex((b) => b > 126),
    -1,
  );
});

test("a portable install works in a folder with spaces and accents, and again over itself", async () => {
  // install.ps1 is the Windows installer; Linux and macOS run install.sh.
  if (!windows) return;
  await using dir = tempDir("colonia-install-ps1-");
  const app = path.join(dir.path, "Colonia de Jos\u00e9 [1]", "app");
  const env = { ...process.env, COLONIA_APP: app, COLONIA_RELEASES: "" };
  const install = (version: string) =>
    spawnSync("powershell", [...shell, "-File", script, "-File", bundle(dir.path, version), "-Portable"], {
      env,
      encoding: "utf8",
      windowsHide: true,
    });
  const command = () => {
    // Started as a user's terminal would, without the installer's variables.
    const clean = { ...process.env, COLONIA_APP: undefined };
    // cmd /c strips the outer quotes of a line that holds more than two: /s and a quoted whole keep the path in one piece.
    const line = `""${path.join(app, "bin", "colonia.cmd")}" status "a b""`;
    const out = execFileSync("cmd.exe", ["/d", "/s", "/c", line], {
      env: clean,
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out.trim());
  };

  const first = install("2.12.1");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(command(), { version: "2.12.1", app, args: ["status", "a b"] });
  assert.match(
    fs.readFileSync(path.join(app, "bin", "colonia.cmd"), "utf8"),
    /^@echo off\r\n/,
    "a batch file's own line ends",
  );

  const second = install("2.12.2");
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(command().version, "2.12.2");
  assert.ok(fs.existsSync(path.join(app, "versions", "2.12.1", "node", "node.exe")), "the earlier version stays");

  // The same version again replaces it.
  const again = install("2.12.2");
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(command().version, "2.12.2");
});

test("a failure ends a script file with 1, and leaves a session it was piped into open and as it was", async () => {
  if (!windows) return;
  await using dir = tempDir("colonia-install-ps1-");
  const env = { ...process.env, COLONIA_APP: path.join(dir.path, "app") };
  const missing = path.join(dir.path, `colonia-core-2.12.1-win-${arch}.tar.gz`);
  const file = spawnSync("powershell", [...shell, "-File", script, "-File", missing, "-Portable"], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(file.status, 1);
  assert.match(file.stdout, /error: no such file/);

  // As `irm | iex` runs it: -NoService keeps it from opening the desktop setup, and nothing listens on that port.
  const piped = [
    `$env:COLONIA_RELEASES = 'http://127.0.0.1:7553'`,
    `$NoService = $true`,
    `Get-Content -Raw -LiteralPath '${script.replaceAll("'", "''")}' | Invoke-Expression`,
    `"after: $ErrorActionPreference $LASTEXITCODE $([bool](Get-Command Die -ErrorAction SilentlyContinue))"`,
  ].join("; ");
  const session = spawnSync("powershell", [...shell, "-Command", piped], { env, encoding: "utf8", windowsHide: true });
  assert.match(session.stdout, /error: could not read the releases/);
  assert.match(session.stdout, /after: Continue 1 False/, session.stdout + session.stderr);
});
