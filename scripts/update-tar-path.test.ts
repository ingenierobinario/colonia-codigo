import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { commandRunner, currentVersion, installRelease } from "../packages/install/src/release.ts";
import { BUNDLE, coreBundleName, type Platform } from "../packages/protocol/src/releases.ts";

const win = process.platform === "win32";
const tarBin = win
  ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : process.platform === "darwin"
    ? "/usr/bin/tar"
    : "tar";

test("TAR-RUTA-ANSI-1: la actualización se instala en una carpeta de usuario con letras fuera de la página de códigos", async () => {
  await using root = tempDir("colonia-release-");
  const platform: Platform = { os: win ? "win" : process.platform === "darwin" ? "mac" : "linux", arch: "x64" };
  const version = "9.9.9";
  const name = coreBundleName(version, platform);
  const node = path.join(root.path, "stage", "colonia", ...BUNDLE.node(win));
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(node, "node");
  assert.equal(spawnSync(tarBin, ["-czf", name, "-C", "stage", "colonia"], { cwd: root.path }).status, 0);
  const bytes = fs.readFileSync(path.join(root.path, name));
  const sum = `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;
  const fakeFetch = (async (url: string) =>
    new Response(url.endsWith(".sha256") ? sum : bytes, { status: 200 })) as unknown as typeof fetch;

  const app = path.join(root.path, "用户 Łukasz", "app");
  fs.mkdirSync(app, { recursive: true });
  await installRelease({
    app,
    release: {
      version,
      notes: [],
      assets: [
        { name, url: `https://feed.test/${name}` },
        { name: `${name}.sha256`, url: `https://feed.test/${name}.sha256` },
      ],
    },
    platform,
    fetch: fakeFetch,
    run: commandRunner(root.path),
  });
  assert.equal(currentVersion(app), version);
  assert.equal(fs.existsSync(path.join(app, BUNDLE.versions, version, ...BUNDLE.node(win))), true);
});
