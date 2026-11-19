// TOOLS-NATIVO-1 y EXPORTAR-IDEMPOTENTE-1.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPackage, writePackage } from "../rpc/project-share.ts";
import { readAgents } from "./read.ts";
import { updateAgentFile } from "./write.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "apc-nativo-"));
const ORIG = "---\nname: x\ndescription: Revisor\ntools: Read, Grep\n---\n\nHaz cosas.\n";
const seed = () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "agents", "x.md"), ORIG);
  return root;
};
const read = (root: string) => fs.readFileSync(path.join(root, ".claude", "agents", "x.md"), "utf8");

test("un agente de .claude/agents guardado con tools: [] conserva su línea tools", () => {
  const root = seed();
  assert.deepEqual(readAgents(root).find((a) => a.slug === "x")?.tools, []);
  updateAgentFile(root, "x", { tools: [] });
  assert.match(read(root), /^tools: Read, Grep$/m);
});

test("añadir una herramienta de Colonia no sustituye las nativas, y el resto de campos sí se guarda", () => {
  const root = seed();
  updateAgentFile(root, "x", { tools: ["web_search"], role: "Rev" });
  const t = read(root);
  assert.match(t, /^tools: Read, Grep$/m);
  assert.match(t, /^role: Rev$/m);
});

test("en .apc/agents las herramientas se siguen escribiendo", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "agents", "y.md"), "---\nname: y\n---\n\nHola.\n");
  updateAgentFile(root, "y", { tools: ["web_search"] });
  assert.match(fs.readFileSync(path.join(root, ".apc", "agents", "y.md"), "utf8"), /^tools:.*web_search/m);
});

test("exportar→importar con reemplazo sobre el mismo proyecto es idempotente y no mete CLAUDE.md en AGENTS.md", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Claude\nREGLA-CLAUDE\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents\nREGLA-AGENTS\n");
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    writePackage(root, buildPackage(root, { name: "P" }, new Date()).pkg);
    seen.push(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"));
  }
  assert.doesNotMatch(seen[2] ?? "", /REGLA-CLAUDE/);
  assert.match(seen[2] ?? "", /REGLA-AGENTS/);
  assert.equal(seen[0], seen[2]);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "# Claude\nREGLA-CLAUDE\n");
});

test("sin AGENTS.md el CLAUDE.md sigue viajando, y el segundo ciclo no lo duplica", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Claude\nREGLA-CLAUDE\n");
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    writePackage(root, buildPackage(root, { name: "P" }, new Date()).pkg);
    seen.push(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"));
  }
  assert.equal((seen[2] ?? "").split("REGLA-CLAUDE").length - 1, 1);
  assert.equal(seen[1], seen[2]);
});
