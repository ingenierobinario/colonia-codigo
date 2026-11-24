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

test("NUCLEO-BUNDLE-1: los paquetes del arranque van dentro; lo nativo y lo perezoso se quedan en node_modules", async () => {
  await using dir = tempDir("colonia-stage-core-");
  const src = path.join(dir.path, "apps", "core", "src");
  fs.mkdirSync(src, { recursive: true });
  const pkg = (name: string, body: string) => {
    const d = path.join(dir.path, "node_modules", name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }));
    fs.writeFileSync(path.join(d, "index.js"), body);
  };
  pkg("zod", "export const z = { origen: import.meta.url };\n");
  pkg("nativo", "export const origen = import.meta.url;\n");
  fs.writeFileSync(
    path.join(src, "main.ts"),
    [
      'import { z } from "zod";',
      'import { origen } from "nativo";',
      'const perezoso = await import("zod");',
      "console.log(JSON.stringify({ dentro: z.origen, fuera: origen, perezoso: perezoso.z.origen }));",
    ].join("\n"),
  );
  await stageCore(dir.path);
  const bundle = path.join(dir.path, CORE_BUNDLE);
  const out = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: "utf8" }));
  assert.ok(out.dentro.endsWith("/apps/core/core.mjs"), `zod estático va dentro del bundle: ${out.dentro}`);
  assert.ok(out.fuera.endsWith("/node_modules/nativo/index.js"), out.fuera);
  assert.ok(out.perezoso.endsWith("/node_modules/zod/index.js"), `import() se queda fuera: ${out.perezoso}`);
});
