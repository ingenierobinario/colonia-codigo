// EXPORTAR-IDEMPOTENTE-1 · Un AGENTS.md vacío no es «instrucciones propias»: no debe tapar el CLAUDE.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { buildPackage } from "./project-share.ts";

const build = async (files: Record<string, string>) => {
  await using dir = tempDir("exp-vacio-");
  const root = dir.path;
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(root, f), t);
  const out = buildPackage(root, { name: "p" }, new Date(0)) as { pkg: { instructions: string } };
  return out.pkg.instructions;
};

test("AGENTS.md vacío o en blanco: el paquete lleva el CLAUDE.md", async () => {
  for (const vacio of ["", "  \n\n"])
    assert.match(await build({ "AGENTS.md": vacio, "CLAUDE.md": "Regla de Claude" }), /Regla de Claude/);
});

test("AGENTS.md con texto: el paquete lleva solo AGENTS.md", async () => {
  const t = await build({ "AGENTS.md": "Regla propia", "CLAUDE.md": "Regla de Claude" });
  assert.match(t, /Regla propia/);
  assert.doesNotMatch(t, /Regla de Claude/);
});
