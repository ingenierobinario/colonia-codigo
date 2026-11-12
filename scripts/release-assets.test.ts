import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { desktopAssetFor } from "../packages/protocol/src/releases.ts";
import {
  badChecksums,
  check,
  checkAssets,
  expectedAssets,
  platformAssets,
  RELEASE_PLATFORMS,
} from "./release-assets.ts";

const V = "1.2.3";

/** Writes every name with real content and a real `<hex>  <name>` sum beside it. */
function fill(dir: string, names: string[]) {
  for (const name of names.filter((n) => !n.endsWith(".sha256"))) {
    fs.writeFileSync(path.join(dir, name), `content of ${name}`);
    const hex = createHash("sha256").update(`content of ${name}`).digest("hex");
    if (!name.startsWith("install.")) fs.writeFileSync(path.join(dir, `${name}.sha256`), `${hex}  ${name}\n`);
  }
}

test("a release carries 40 distinct files", () => {
  const all = expectedAssets(V);
  assert.equal(all.length, 40);
  assert.equal(new Set(all).size, 40);
  for (const n of [
    "colonia-core-1.2.3-win-x64.tar.gz.sha256",
    "Colonia-1.2.3-linux-x86_64.AppImage",
    "Colonia-1.2.3-linux-amd64.deb",
    "Colonia-1.2.3-linux-x86_64.rpm.sha256",
    "Colonia-1.2.3-linux-arm64.deb",
    "Colonia-1.2.3-linux-aarch64.rpm",
    "install.ps1",
  ])
    assert.ok(all.includes(n), n);
});

test("the updater finds every platform's installer and zip in the list", () => {
  const assets = expectedAssets(V).map((name) => ({ name, url: "" }));
  for (const p of RELEASE_PLATFORMS) {
    const slice = platformAssets(V, p);
    for (const kind of ["installer", "zip"] as const) {
      const found = desktopAssetFor(assets, V, p, kind);
      assert.ok(found && slice.includes(found.name), `${p.os}-${p.arch} ${kind}`);
    }
    for (const kind of ["deb", "rpm"] as const) {
      const found = desktopAssetFor(assets, V, p, kind);
      if (p.os === "linux") assert.ok(found && slice.includes(found.name), `${p.os}-${p.arch} ${kind}`);
      else assert.equal(found, undefined);
    }
  }
});

test("missing files are always reported, strays only in exact mode", () => {
  const want = expectedAssets(V);
  const present = [...want.slice(1), "builder-debug.yml"];
  assert.deepEqual(checkAssets(want, present, true), { missing: [want[0]], unexpected: ["builder-debug.yml"] });
  assert.deepEqual(checkAssets(want, present, false), { missing: [want[0]], unexpected: [] });
  assert.deepEqual(checkAssets(want, want, true), { missing: [], unexpected: [] });
});

test("a wrong or missing checksum is reported", async () => {
  await using dir = tempDir();
  const slice = platformAssets(V, { os: "win", arch: "x64" });
  fill(dir.path, slice);
  assert.deepEqual(badChecksums(dir.path, slice), []);
  const [installer, , zip] = slice as [string, string, string];
  fs.appendFileSync(path.join(dir.path, installer), "x");
  fs.rmSync(path.join(dir.path, `${zip}.sha256`));
  assert.deepEqual(badChecksums(dir.path, slice), [`${installer}: checksum does not match`, `${zip}: no .sha256`]);
});

test("the CLI passes the exact set and fails one file short or one file over", async () => {
  await using dir = tempDir();
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  fill(dir.path, expectedAssets(V));
  assert.equal(check([V, dir.path], log), 0);
  // A build runner's out/ holds leftovers: the slice check ignores them, the whole-set check does not.
  fs.mkdirSync(path.join(dir.path, ".icon-ico"));
  fs.writeFileSync(path.join(dir.path, "builder-effective-config.yaml"), "");
  assert.equal(check([V, dir.path, "--platform", "linux-arm64"], log), 0);
  assert.equal(check([V, dir.path], log), 1);
  assert.ok(lines.includes("unexpected: builder-effective-config.yaml"));
  fs.rmSync(path.join(dir.path, "install.sh"));
  fs.rmSync(path.join(dir.path, "builder-effective-config.yaml"));
  assert.equal(check([V, dir.path], log), 1);
  assert.ok(lines.includes("missing: install.sh"));
  assert.equal(check([V, dir.path, "--platform", "beos-x64"], log), 2);
});
