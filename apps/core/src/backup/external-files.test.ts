import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { externalFiles } from "./inventory.ts";

test("una copia conserva las definiciones nativas y añade los documentos externos sólo al elegirlo", async (t) => {
  const dir = tempDir("colonia-proyecto-externo-");
  t.after(() => dir.remove());
  const definitions = [
    "AGENTS.md",
    "CLAUDE.md",
    ".apc/project.json",
    ".claude/agents/grupo/revisor.md",
    ".codex/agents/editor.toml",
    ".agents/skills/resumen/SKILL.md",
    ".cursor/rules/proyecto.mdc",
    ".github/copilot-instructions.md",
  ];
  const work = ["manual/informe.pdf", "src/índice.ts"];
  const omitted = [
    ".env",
    ".codex/auth.json",
    ".claude/sessions/fixture.txt",
    "node_modules/mod/index.js",
    ".git/config",
    "documentos/credentials.json",
    "Colonia-copia.colonia",
    "copia.colonia.parcial",
  ];
  for (const name of [...definitions, ...work, ...omitted]) {
    const file = path.join(dir.path, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "contenido de prueba");
  }
  assert.deepEqual((await externalFiles(dir.path)).map((f) => f.rel).sort(), definitions.toSorted());
  assert.deepEqual((await externalFiles(dir.path, true)).map((f) => f.rel).sort(), [...definitions, ...work].sort());
});
