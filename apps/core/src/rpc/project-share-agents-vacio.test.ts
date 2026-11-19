// EXPORTAR-IDEMPOTENTE-1 · Un AGENTS.md vacío no es «instrucciones propias»: no debe tapar el CLAUDE.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPackage } from "./project-share.ts";

const build = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exp-vacio-"));
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(root, f), t);
  const out = buildPackage(root, { name: "p" }, new Date(0)) as { pkg: { instructions: string } };
  fs.rmSync(root, { recursive: true, force: true });
  return out.pkg.instructions;
};

test("AGENTS.md vacío o en blanco: el paquete lleva el CLAUDE.md", () => {
  for (const vacio of ["", "  \n\n"])
    assert.match(build({ "AGENTS.md": vacio, "CLAUDE.md": "Regla de Claude" }), /Regla de Claude/);
});

test("AGENTS.md con texto: el paquete lleva solo AGENTS.md", () => {
  const t = build({ "AGENTS.md": "Regla propia", "CLAUDE.md": "Regla de Claude" });
  assert.match(t, /Regla propia/);
  assert.doesNotMatch(t, /Regla de Claude/);
});
