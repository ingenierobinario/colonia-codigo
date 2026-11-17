import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildPackage, writePackage } from "../rpc/project-share.ts";
import { tempDir } from "../testkit/platform.ts";
import { copyPortableAgents, portableAgents } from "./portable-agents.ts";
import { readAgents } from "./read.ts";

test("el paquete conserva subagentes de Claude en carpetas y la definición TOML de Codex", async () => {
  await using source = tempDir("colonia-equipo-nativo-");
  await using target = tempDir("colonia-equipo-importado-");
  const claude = path.join(source.path, ".claude", "agents", "ventas");
  const codex = path.join(source.path, ".codex", "agents");
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(
    path.join(claude, "revisor.md"),
    "---\nname: Revisor\nparent: redactor\nskills: revisar\n---\nRevisa las notas.",
  );
  fs.writeFileSync(
    path.join(codex, "autor.toml"),
    [
      'name = "redactor"',
      "description = 'Escribe notas'",
      'model = "modelo-ejemplo"',
      'model_reasoning_effort = "high"',
      'developer_instructions = """',
      "Prepara un resumen.",
      "Conserva los acentos: acción.",
      '"""',
    ].join("\n"),
  );
  const hidden = path.join(claude, ".archived");
  fs.mkdirSync(hidden);
  fs.writeFileSync(path.join(hidden, "desactivado.md"), "Antiguo");
  const { pkg } = buildPackage(source.path, { name: "Equipo" }, new Date());
  writePackage(target.path, pkg);
  const agents = readAgents(target.path);
  assert.deepEqual(agents.map((a) => a.slug).sort(), ["redactor", "revisor"]);
  const author = agents.find((a) => a.slug === "redactor");
  assert.equal(author?.description, "Escribe notas");
  assert.equal(author?.model, "codex:modelo-ejemplo#high");
  assert.equal(author?.prompt, "Prepara un resumen.\nConserva los acentos: acción.");
  const reviewer = agents.find((a) => a.slug === "revisor");
  assert.equal(reviewer?.parent, "redactor");
  assert.deepEqual(reviewer?.skills, ["revisar"]);
});

test("la importación nativa se puede repetir y respeta archivos existentes y restricciones del origen", async () => {
  await using dir = tempDir("colonia-copias-nativas-");
  const codex = path.join(dir.path, ".codex", "agents");
  fs.mkdirSync(codex, { recursive: true });
  const source = 'name = "editor"\ndescription = "Revisión"\ndeveloper_instructions = "Lee el texto."\n';
  fs.writeFileSync(path.join(codex, "archivo.toml"), source);
  fs.writeFileSync(
    path.join(codex, "restringido.toml"),
    source.replace("editor", "lector") + "[features]\nshell_tool = false\n",
  );
  assert.equal(portableAgents(dir.path, "codex").skipped, 1);
  assert.deepEqual(copyPortableAgents(dir.path, "codex"), { added: 1, skipped: 1 });
  const file = path.join(dir.path, ".apc", "agents", "editor.md");
  assert.match(fs.readFileSync(file, "utf8"), /Lee el texto/);
  fs.writeFileSync(file, "Instrucciones locales.");
  assert.deepEqual(copyPortableAgents(dir.path, "codex"), { added: 0, skipped: 1 });
  assert.equal(fs.readFileSync(file, "utf8"), "Instrucciones locales.");
  assert.equal(fs.readFileSync(path.join(codex, "archivo.toml"), "utf8"), source);
  assert.deepEqual(
    readAgents(dir.path).map((a) => a.slug),
    ["editor"],
  );
});
