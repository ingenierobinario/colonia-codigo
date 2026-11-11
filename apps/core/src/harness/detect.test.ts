import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { assertPath, tempDir } from "../testkit/platform.ts";
import { codexNative, lookup, sdkPath } from "./detect.ts";

const write = (file: string, text = "") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

test("Codex's native program is found from its npm launcher, in the platform package or the old vendor folder", async () => {
  await using dir = tempDir("colonia-codex-");
  const pkg = path.join(dir.path, "node_modules", "@openai", "codex");
  const launcher = write(path.join(pkg, "bin", "codex.js"));
  assert.equal(codexNative(launcher, "x64"), undefined, "a launcher alone hides no program");

  const old = write(path.join(pkg, "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"));
  assert.equal(codexNative(launcher, "x64"), old);
  assert.equal(codexNative(launcher, "arm64"), undefined, "the other processor's program is not this one's");

  const platform = path.join(pkg, "node_modules", "@openai", "codex-win32-x64");
  write(path.join(platform, "package.json"), JSON.stringify({ name: "@openai/codex-win32-x64", version: "1.0.0" }));
  const native = write(path.join(platform, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"));
  assert.equal(fs.realpathSync(codexNative(launcher, "x64") ?? ""), fs.realpathSync(native));
});

test("a program is looked for on the PATH its caller will start it with, not only this core's own", async () => {
  await using dir = tempDir("colonia-lookup-");
  const name = "colonia-lookup-probe";
  const file = write(path.join(dir.path, process.platform === "win32" ? `${name}.exe` : name), "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
  assert.equal(await lookup(name), undefined, "not on this core's PATH");
  // Windows names the variable Path.
  const key = process.platform === "win32" ? "Path" : "PATH";
  assertPath(await lookup(name, { [key]: dir.path }), file);
});

test("an SDK gets a program that starts without a shell: the shim's target, never the shim", async () => {
  assert.equal(await sdkPath("codex", async () => undefined), undefined);
  assert.equal(await sdkPath("claude", async () => process.execPath), process.execPath);
  // Batch files exist only on Windows.
  if (process.platform !== "win32") return;
  await using dir = tempDir("colonia-sdk-");
  const exe = write(path.join(dir.path, "node_modules", "cli", "bin", "claude.exe"));
  const native = write(path.join(dir.path, "claude.cmd"), '@"%~dp0\\node_modules\\cli\\bin\\claude.exe"   %*\r\n');
  assert.equal(await sdkPath("claude", async () => native), exe);

  const script = write(path.join(dir.path, "node_modules", "@openai", "codex", "bin", "codex.js"));
  const viaNode = `@"${process.execPath}" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;
  const shim = write(path.join(dir.path, "codex.cmd"), viaNode);
  // Claude's SDK runs a script with Node itself; Codex's needs the program the launcher would start.
  assert.equal(await sdkPath("claude", async () => shim), script);
  await assert.rejects(
    sdkPath("codex", async () => shim),
    /Windows script/,
  );
  const codex = write(
    path.join(dir.path, "node_modules", "@openai", "codex", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
  );
  if (process.arch === "x64") assert.equal(await sdkPath("codex", async () => shim), codex);

  const more = write(path.join(dir.path, "more.cmd"), '@set MODE=x\r\n@"%~dp0\\claude.exe" %*\r\n');
  await assert.rejects(
    sdkPath("claude", async () => more),
    /Windows script/,
  );
});
