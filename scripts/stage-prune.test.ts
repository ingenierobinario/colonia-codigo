import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { prunable, pruneModules } from "../apps/desktop/scripts/stage-prune.ts";

test("prunable takes types, maps and tool configs but never code, docs or licences", () => {
  for (const name of [
    "index.d.ts",
    "index.d.mts",
    "index.d.cts",
    "index.js.map",
    "index.mjs.map",
    "index.cjs.map",
    "index.d.ts.map",
    "index.mts.map",
    "index.cts.map",
    "style.css.map",
    "tsconfig.tsbuildinfo",
    ".eslintrc",
    ".eslintrc.json",
    ".nycrc",
    ".prettierrc.yml",
    ".editorconfig",
    ".npmignore",
  ])
    assert.equal(prunable(name), true, name);
  for (const name of [
    "index.js",
    "index.mjs",
    "index.cjs",
    "index.ts",
    "index.mts",
    "package.json",
    "README.md",
    "CHANGELOG.markdown",
    "LICENSE.md",
    "license.markdown",
    "Licence.md",
    "NOTICE.md",
    "COPYING.md",
    "map.js",
    "readme.js",
    "d.ts.js",
  ])
    assert.equal(prunable(name), false, name);
});

test("pruneModules deletes only prunable files, in every depth", async () => {
  const dir = tempDir("colonia-stage-prune-");
  try {
    const mods = path.join(dir.path, "node_modules");
    const files = {
      "a/index.js": "x",
      "a/index.d.ts": "xx",
      "a/README.md": "xxx",
      "a/LICENSE.md": "l",
      "@s/b/dist/esm/index.mjs": "m",
      "@s/b/dist/esm/index.mjs.map": "mmmm",
    };
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(mods, rel)), { recursive: true });
      fs.writeFileSync(path.join(mods, rel), body);
    }
    assert.deepEqual(pruneModules(mods), { files: 2, bytes: 6 });
    for (const rel of ["a/index.js", "a/README.md", "a/LICENSE.md", "@s/b/dist/esm/index.mjs"])
      assert.ok(fs.existsSync(path.join(mods, rel)), rel);
    for (const rel of ["a/index.d.ts", "@s/b/dist/esm/index.mjs.map"])
      assert.ok(!fs.existsSync(path.join(mods, rel)), rel);
    assert.deepEqual(pruneModules(path.join(dir.path, "missing")), { files: 0, bytes: 0 });
  } finally {
    await dir.remove();
  }
});
