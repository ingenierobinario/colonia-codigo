import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
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
    if (process.env.COLONIA_TEST_CALLS) process.getBuiltinModule("node:fs").appendFileSync(process.env.COLONIA_TEST_CALLS, ${JSON.stringify(version)} + " " + process.argv.slice(2).join(" ") + "\\n");
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

/**
 * A non-portable install writes the user's PATH, a registry value no environment variable redirects: it is read
 * first and written back after. npm stays off the PATH the installer sees, so no global package is looked at.
 */
async function withUserPath(run: () => Promise<void>): Promise<void> {
  const ps = (command: string) =>
    execFileSync("powershell", [...shell, "-Command", command], { encoding: "utf8", windowsHide: true });
  const saved = ps(`[Environment]::GetEnvironmentVariable('Path', 'User')`).replace(/\r?\n$/, "");
  try {
    await run();
  } finally {
    ps(`[Environment]::SetEnvironmentVariable('Path', '${saved.replaceAll("'", "''")}', 'User')`);
  }
}

/** The installer's environment: its app folder, a log of every call the bundle's terminal gets, and no npm. */
function installEnv(app: string, calls: string, feed = ""): NodeJS.ProcessEnv {
  const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COLONIA_APP: app,
    COLONIA_RELEASES: feed,
    COLONIA_TEST_CALLS: calls,
  };
  for (const key of Object.keys(env)) if (/^(path|ssh_connection|ssh_tty)$/i.test(key)) delete env[key];
  env.Path = [system, path.join(system, "WindowsPowerShell", "v1.0")].join(";");
  return env;
}

/** A GitHub-shaped feed serving these bundles (and their .sha256) under /download/v<x.y.z>/. */
async function serveBundles(files: string[]): Promise<{ url: string; [Symbol.asyncDispose](): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
    const file = files.find((f) => path.basename(f) === name);
    const hash = files.find((f) => `${path.basename(f)}.sha256` === name);
    if (file) res.end(fs.readFileSync(file));
    else if (hash) res.end(crypto.createHash("sha256").update(fs.readFileSync(hash)).digest("hex"));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, [Symbol.asyncDispose]: () => new Promise((r) => server.close(() => r())) };
}

const calls = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/) : []);
const linked = (app: string) => fs.realpathSync(path.join(app, "current"));

test("a desktop install over an earlier desktop install points current at the new version", async () => {
  if (!windows) return;
  await withUserPath(async () => {
    await using dir = tempDir("colonia-install-ps1-");
    const app = path.join(dir.path, "app");
    const log = path.join(dir.path, "calls.txt");
    await using feed = await serveBundles([bundle(dir.path, "2.12.1"), bundle(dir.path, "2.12.2")]);
    // -File is server-only: desktop mode downloads, as from the public feed. Not spawnSync: this process serves it.
    const install = (version: string) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        execFile(
          "powershell",
          [...shell, "-File", script, "-Desktop", "-Feed", feed.url, "-Version", version],
          { env: installEnv(app, log, feed.url), encoding: "utf8", windowsHide: true, timeout: 120_000 },
          (err, stdout, stderr) =>
            resolve({ status: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
        );
      });
    const first = await install("2.12.1");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(linked(app), fs.realpathSync(path.join(app, "versions", "2.12.1")));
    const second = await install("2.12.2");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(linked(app), fs.realpathSync(path.join(app, "versions", "2.12.2")), second.stdout);
    assert.deepEqual(calls(log), ["2.12.1 desktop", "2.12.2 desktop"]);
  });
});

test("-NoService over an installed server leaves its service alone and says how to remove it", async () => {
  if (!windows) return;
  await withUserPath(async () => {
    await using dir = tempDir("colonia-install-ps1-");
    const app = path.join(dir.path, "app");
    const log = path.join(dir.path, "calls.txt");
    const install = (version: string) =>
      spawnSync("powershell", [...shell, "-File", script, "-File", bundle(dir.path, version), "-NoService"], {
        env: installEnv(app, log),
        encoding: "utf8",
        windowsHide: true,
      });
    const first = install("2.12.1");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    // The login entry `colonia service install` would have written, running this install's Node.
    const value = `ColoniaInstallTest-${path.basename(dir.path)}`;
    const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const data = `"${path.join(app, "current", "node", "node.exe")}" service run`;
    execFileSync("reg", ["add", runKey, "/v", value, "/t", "REG_SZ", "/d", data, "/f"], { windowsHide: true });
    try {
      const second = install("2.12.2");
      assert.equal(second.status, 0, second.stdout + second.stderr);
      assert.deepEqual(calls(log), [], "no service command ran");
      assert.match(
        second.stdout,
        new RegExp(`already installed \\(login entry ${value}\\).*colonia service uninstall`),
      );
      assert.equal(linked(app), fs.realpathSync(path.join(app, "versions", "2.12.2")));
    } finally {
      execFileSync("reg", ["delete", runKey, "/v", value, "/f"], { windowsHide: true, stdio: "ignore" });
    }
  });
});
