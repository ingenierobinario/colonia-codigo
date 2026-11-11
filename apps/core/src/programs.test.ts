import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  findCommand,
  isWindowsShim,
  nvmBin,
  shimTarget,
  spawnable,
  toSpawn,
  windowsDirs,
  withUsualDirs,
} from "./programs.ts";
import { tempDir } from "./testkit/platform.ts";

test("a bare PATH gets the usual folders it lacks at its end, only those that exist and once", async () => {
  await using dir = tempDir("colonia-programs-");
  const brew = path.join(dir.path, "homebrew", "bin");
  const local = path.join(dir.path, ".local", "bin");
  fs.mkdirSync(brew, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  const missing = path.join(dir.path, "nowhere", "bin");
  const bare = ["/usr/bin", "/bin"].join(path.delimiter);
  assert.equal(withUsualDirs(bare, [brew, missing, local], "darwin"), [bare, brew, local].join(path.delimiter));
  // A folder already on the PATH keeps its place: the owner's order wins.
  const own = [local, "/usr/bin"].join(path.delimiter);
  assert.equal(withUsualDirs(own, [brew, local], "linux"), [own, brew].join(path.delimiter));
  assert.equal(withUsualDirs("", [brew], "darwin"), brew);
  // Windows too, where the same folder is written in any case and with or without a closing separator.
  const windows = `C:\\Windows\\System32;${brew.toUpperCase()}\\`;
  assert.equal(withUsualDirs(windows, [brew, missing, local, local], "win32"), `${windows};${local}`);
});

test("nvm's programs are those of the newest Node it installed, compared as versions", async () => {
  await using dir = tempDir("colonia-nvm-");
  const home = dir.path;
  assert.equal(nvmBin(home), undefined, "no nvm, no folder");
  for (const v of ["v9.11.2", "v22.4.0", "v20.18.1", "system"])
    fs.mkdirSync(path.join(home, ".nvm", "versions", "node", v, "bin"), { recursive: true });
  assert.equal(nvmBin(home), path.join(home, ".nvm", "versions", "node", "v22.4.0", "bin"));
});

test("Windows' usual folders follow each manager's own variable, and winget's newest Node", () => {
  const env = { UserProfile: "C:\\Users\\ana", LOCALAPPDATA: "D:\\Local", APPDATA: "D:\\Roaming" };
  const packages = "D:\\Local\\Microsoft\\WinGet\\Packages";
  const list = (dir: string) =>
    dir === packages
      ? ["OpenJS.NodeJS.LTS_Source", "Other.Tool_Source"]
      : dir === `${packages}\\OpenJS.NodeJS.LTS_Source`
        ? ["node-v9.11.2-win-x64", "node-v22.4.0-win-x64", "notes.txt"]
        : [];
  const dirs = windowsDirs(env, list);
  for (const expected of [
    "C:\\Users\\ana\\.local\\bin",
    "D:\\Roaming\\npm",
    "D:\\Local\\pnpm",
    "D:\\Local\\Volta\\bin",
    "C:\\Users\\ana\\.bun\\bin",
    "C:\\Users\\ana\\scoop\\shims",
    "D:\\Roaming\\fnm\\aliases\\default",
    "D:\\Local\\Microsoft\\WinGet\\Links",
    `${packages}\\OpenJS.NodeJS.LTS_Source\\node-v22.4.0-win-x64`,
    "C:\\Program Files\\nodejs",
  ])
    assert.ok(dirs.includes(expected), expected);
  assert.ok(dirs.indexOf("C:\\Users\\ana\\.local\\bin") < dirs.indexOf("D:\\Roaming\\npm"), "native installs first");

  const moved = windowsDirs(
    {
      ...env,
      PNPM_HOME: "E:\\pnpm",
      VOLTA_HOME: "E:\\volta",
      SCOOP: "E:\\scoop",
      FNM_DIR: "E:\\fnm",
      NVM_SYMLINK: "E:\\nvm\\current",
      ProgramFiles: "E:\\Programs",
    },
    () => [],
  );
  for (const expected of [
    "E:\\pnpm",
    "E:\\volta\\bin",
    "E:\\scoop\\shims",
    "E:\\scoop\\apps\\nodejs\\current",
    "E:\\fnm\\aliases\\default",
    "E:\\nvm\\current",
    "E:\\Programs\\nodejs",
  ])
    assert.ok(moved.includes(expected), expected);
  assert.equal(moved.includes("D:\\Local\\pnpm"), false);
});

test("a Windows command is the program that starts by itself wherever it is, else a shim, the PATH first", () => {
  const on = (...files: string[]) => {
    const have = new Set(files.map((f) => f.toLowerCase()));
    return (file: string) => have.has(file.toLowerCase());
  };
  const envPath = 'C:\\npm;"C:\\With Space\\bin";C:\\tools\\';
  assert.equal(findCommand("codex", envPath, [], on("C:\\npm\\codex.cmd")), "C:\\npm\\codex.cmd");
  assert.equal(
    findCommand("codex", envPath, ["C:\\usual"], on("C:\\npm\\codex.cmd", "C:\\usual\\codex.exe")),
    "C:\\usual\\codex.exe",
    "an .exe in a usual folder wins over a shim on the PATH",
  );
  assert.equal(
    findCommand("agy", envPath, ["C:\\usual"], on("C:\\tools\\agy.bat", "C:\\usual\\agy.cmd")),
    "C:\\tools\\agy.bat",
  );
  assert.equal(findCommand("x", envPath, [], on("C:\\With Space\\bin\\x.exe")), "C:\\With Space\\bin\\x.exe");
  assert.equal(findCommand("gemini", "", ["C:\\usual"], on("C:\\usual\\gemini.cmd")), "C:\\usual\\gemini.cmd");
  // npm writes a shell script without extension beside each shim: Windows cannot start it.
  assert.equal(findCommand("codex", envPath, [], on("C:\\npm\\codex")), undefined);
  assert.equal(findCommand("codex.cmd", envPath, [], on("C:\\npm\\codex.cmd")), "C:\\npm\\codex.cmd");
});

const crlf = (...lines: string[]) => lines.join("\r\n");
const only = (...files: string[]) => {
  const have = new Set(files.map((f) => f.toLowerCase()));
  return (file: string) => have.has(file.toLowerCase());
};
const NPM_HEAD = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
];
const npmShim = (script: string, ...before: string[]) =>
  crlf(
    ...NPM_HEAD,
    ...before,
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`,
    "",
  );
const node = (name: string) => (name === "node" ? "C:\\node\\node.exe" : undefined);

test("npm's shim starts Node with the package's script: the node beside it, else the one found", () => {
  const text = npmShim("node_modules\\@acme\\cli\\bin\\cli.js");
  const script = "C:\\Users\\ana maría\\npm\\node_modules\\@acme\\cli\\bin\\cli.js";
  const shim = "C:\\Users\\ana maría\\npm\\cli.cmd";
  assert.deepEqual(shimTarget(text, shim, { exists: only(), find: node, env: {} }), {
    file: "C:\\node\\node.exe",
    args: [script],
  });
  const beside = "C:\\Users\\ana maría\\npm\\node.exe";
  assert.deepEqual(shimTarget(text, shim, { exists: only(beside), find: node, env: {} }), {
    file: beside,
    args: [script],
  });
  assert.equal(shimTarget(text, shim, { exists: only(), find: () => undefined, env: {} }), undefined, "no Node");
});

test("a shim of a native program starts that program", () => {
  const text = crlf(...NPM_HEAD, '"%dp0%\\node_modules\\@acme\\cli\\bin\\cli.exe"   %*', "");
  const exe = "C:\\npm\\node_modules\\@acme\\cli\\bin\\cli.exe";
  assert.deepEqual(shimTarget(text, "C:\\npm\\cli.cmd", { exists: only(exe), env: {} }), { file: exe, args: [] });
  assert.equal(shimTarget(text, "C:\\npm\\cli.cmd", { exists: only(), env: {} }), undefined, "the program is gone");
});

test("older npm and pnpm shims, which repeat the start line for each case", () => {
  const old = crlf(
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\foo\\bin\\foo.js" %*',
    ") ELSE (",
    "  @SETLOCAL",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\node_modules\\foo\\bin\\foo.js" %*',
    ")",
  );
  assert.deepEqual(shimTarget(old, "C:\\npm\\foo.cmd", { exists: only(), find: node, env: {} }), {
    file: "C:\\node\\node.exe",
    args: ["C:\\npm\\node_modules\\foo\\bin\\foo.js"],
  });
  const pnpm = crlf(
    "@SETLOCAL",
    "@IF NOT DEFINED NODE_PATH (",
    '  @SET "NODE_PATH=C:\\pnpm\\global\\5\\node_modules"',
    ") ELSE (",
    '  @SET "NODE_PATH=C:\\pnpm\\global\\5\\node_modules;%NODE_PATH%"',
    ")",
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\foo\\bin\\foo.js" %*',
    ") ELSE (",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\global\\5\\node_modules\\foo\\bin\\foo.js" %*',
    ")",
  );
  assert.deepEqual(shimTarget(pnpm, "C:\\pnpm\\foo.cmd", { exists: only("C:\\pnpm\\node.exe"), env: {} }), {
    file: "C:\\pnpm\\node.exe",
    args: ["C:\\pnpm\\global\\5\\node_modules\\foo\\bin\\foo.js"],
  });
});

test("a launcher that keeps its paths in variables, and one that names itself to a manager", () => {
  const npx = crlf(
    ":: Created by npm, please don't edit manually.",
    "@ECHO OFF",
    "SETLOCAL",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'IF NOT EXIST "%NODE_EXE%" (',
    '  SET "NODE_EXE=node"',
    ")",
    'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
    'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
    `FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (`,
    '  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"',
    ")",
    'IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (',
    '  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"',
    ")",
    '"%NODE_EXE%" "%NPX_CLI_JS%" %*',
  );
  const cli = "C:\\node\\node_modules\\npm\\bin\\npx-cli.js";
  assert.deepEqual(shimTarget(npx, "C:\\node\\npx.cmd", { exists: only("C:\\node\\node.exe", cli), env: {} }), {
    file: "C:\\node\\node.exe",
    args: [cli],
  });

  const manager = (name: string) => (name === "volta" ? "C:\\Volta\\volta.exe" : undefined);
  assert.deepEqual(
    shimTarget(crlf("@echo off", "volta run %~n0 %*"), "C:\\Volta\\bin\\codex.cmd", { find: manager, env: {} }),
    { file: "C:\\Volta\\volta.exe", args: ["run", "codex"] },
  );
  // A variable of the process, not of the script.
  assert.deepEqual(
    shimTarget(crlf("@echo off", '"%TOOLS%\\bin\\x.exe" --quiet %*'), "C:\\a\\x.cmd", {
      exists: only("D:\\tools\\bin\\x.exe"),
      env: { Tools: "D:\\tools" },
    }),
    { file: "D:\\tools\\bin\\x.exe", args: ["--quiet"] },
  );
});

test("a script that does more than start one program has no answer, rather than a wrong one", () => {
  const exe = "C:\\a\\x.exe";
  const none = (...lines: string[]) =>
    assert.equal(shimTarget(crlf(...lines), "C:\\a\\x.cmd", { exists: only(exe), find: node, env: {} }), undefined);
  // The control: the same start line alone is understood.
  assert.deepEqual(shimTarget('@"%~dp0x.exe" %*', "C:\\a\\x.cmd", { exists: only(exe), env: {} }), {
    file: exe,
    args: [],
  });
  none("@SET API_MODE=fast", '@"%~dp0x.exe" %*'); // a variable for the program
  none("@set PATH=%~dp0tools;%PATH%", '@"%~dp0x.exe" %*'); // its own PATH
  none("@where /q pwsh.exe", '@"%~dp0x.exe" %*'); // another command
  none('@del "%TEMP%\\x.lock"', '@"%~dp0x.exe" %*');
  none('@if exist "%~dp0old.txt" del "%~dp0old.txt"', '@"%~dp0x.exe" %*'); // a command hidden in an if
  none('@"%~dp0x.exe" %* > "%~dp0x.log"'); // redirection is not a start line and nothing else starts
  none('@"%~dp0x.exe" < "%~dp0answers.txt" %*');
  none("@setlocal EnableDelayedExpansion", '@"%~dp0x.exe" %*');
  none('@"%UNKNOWN_ROOT%\\x.exe" %*'); // a variable nobody set
  none("@set /a N=1+1", '@"%~dp0x.exe" %*');
  none("@echo off", "echo nothing starts here");
});

test("only a Windows .cmd or .bat is a shim; anything else is handed to spawn as it is", () => {
  assert.equal(isWindowsShim("C:\\cli\\agy.CMD", "win32"), true);
  assert.equal(isWindowsShim("C:\\cli\\agy.bat", "win32"), true);
  assert.equal(isWindowsShim("C:\\cli\\agy.exe", "win32"), false);
  assert.equal(isWindowsShim("/opt/agy.cmd", "linux"), false);
  assert.deepEqual(spawnable("/opt/agy.cmd", ["-v"], "linux"), { file: "/opt/agy.cmd", args: ["-v"] });
  assert.deepEqual(spawnable("C:\\cli\\agy.exe", ["-v"], "win32"), { file: "C:\\cli\\agy.exe", args: ["-v"] });
  // A shim that is not there (or cannot be reduced) says so in words, not with Node's EINVAL.
  assert.equal(spawnable("C:\\nowhere\\agy.cmd", [], "win32"), undefined);
  assert.throws(() => toSpawn("C:\\nowhere\\agy.cmd", [], "win32"), /Windows script/);
});

test("a real shim on disk starts through what it names, with arguments a shell would mangle intact", async () => {
  // Batch files exist only on Windows, and their paths only parse there.
  if (process.platform !== "win32") return;
  await using dir = tempDir("colonia shim ñ-");
  const script = path.join(dir.path, "node_modules", "echo", "echo.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
  const shim = path.join(dir.path, "echo.cmd");
  fs.writeFileSync(shim, npmShim("node_modules\\echo\\echo.js"));
  // A shim of that shim, as Yarn's global folder writes them.
  const outer = path.join(dir.path, "outer.cmd");
  fs.writeFileSync(outer, crlf('@"%~dp0\\echo.cmd"   %*', ""));
  const tricky = ["", 'say "hi" & calc', "100%PATH%", "a^b", "ñ"];
  for (const file of [shim, outer]) {
    const start = toSpawn(file, tricky);
    assert.equal(path.basename(start.file).toLowerCase(), "node.exe");
    assert.deepEqual(start.args, [script, ...tricky]);
    const out = execFileSync(start.file, start.args, { encoding: "utf8", windowsHide: true });
    assert.deepEqual(JSON.parse(out), tricky);
  }
});
