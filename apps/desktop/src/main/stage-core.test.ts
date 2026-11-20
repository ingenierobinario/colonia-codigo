import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { CORE_BUNDLE, stageCore } from "../../scripts/stage-core.ts";

test("ARRANQUE-RAPIDO-1: el núcleo en un fichero sigue viendo cada módulo en su sitio", async () => {
  await using dir = tempDir("colonia-stage-core-");
  const src = path.join(dir.path, "apps", "core", "src");
  fs.mkdirSync(path.join(src, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(src, "lib", "where.ts"),
    'import path from "node:path";\nexport const where = (): string => import.meta.dirname;\nexport const url = (): string => import.meta.url;\nexport const solo: boolean = import.meta.main;\nexport const join = path.join;\n',
  );
  fs.writeFileSync(
    path.join(src, "main.ts"),
    'import { where, url, solo } from "./lib/where.ts";\nconsole.log(JSON.stringify({ where: where(), url: url(), solo, main: import.meta.dirname }));\n',
  );
  await stageCore(dir.path);
  const bundle = path.join(dir.path, CORE_BUNDLE);
  const out = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: "utf8" }));
  assert.equal(out.where, path.join(src, "lib"));
  assert.ok(out.url.endsWith("/apps/core/src/lib/where.ts"), out.url);
  assert.equal(out.solo, false, "solo el núcleo entero es «main»");
  assert.equal(out.main, src);
});
