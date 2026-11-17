// AGENTES-NATIVOS-1 · ESCRITURA-EN-ORIGEN-1 · Un proyecto de Claude Code (o de Codex) se lee en su carpeta: sus
// agentes de `.claude/agents`, sus skills de `.claude/skills` y su CLAUDE.md. La carpeta manda: lo que se crea, cambia
// o borra ahí se ve sin hacer nada, y lo que Colonia cambia vuelve a ese mismo fichero.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { readAgents, readProject } from "./read.ts";

const w = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

function claudeProject(root: string) {
  w(root, "CLAUDE.md", "# Tienda\n\nResponde siempre en español.\n");
  w(
    root,
    ".claude/agents/revisor.md",
    "---\nname: revisor\ndescription: Revisa el código\ntools: Read, Grep\n---\nRevisa con cuidado.\n",
  );
  w(root, ".claude/skills/despliegue/SKILL.md", "---\nname: despliegue\ndescription: Cómo se despliega\n---\nPasos.\n");
  w(root, ".codex/agents/probador.md", "---\nname: probador\n---\nPrueba.\n");
}

test("se leen en su sitio los agentes de .claude/.codex y el CLAUDE.md; .apc manda con el mismo nombre", async () => {
  await using dir = tempDir("colonia-nativo-");
  claudeProject(dir.path);
  w(dir.path, ".apc/agents/probador.md", "---\nname: Probador propio\n---\nDe .apc.\n");
  const agents = readAgents(dir.path);
  assert.deepEqual(
    agents.map((a) => [a.slug, a.name, a.from ?? "apc", a.tools.length]),
    [
      ["probador", "Probador propio", "apc", 0],
      ["revisor", "revisor", "claude", 0],
    ],
  );
  assert.match(readProject(dir.path).context ?? "", /Responde siempre en español/);
});

test("la carpeta manda: crear, cambiar y borrar un agente en .claude/agents se ve solo; editar en Colonia escribe allí", async () => {
  await using dir = tempDir("colonia-nativo-vivo-");
  const root = dir.path;
  claudeProject(root);
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { project } = await env.client.call("projects.register", { path: root });
    const live = async () =>
      (await env.client.call("agents.list", {})).agents.filter((a) => a.project_id === project.id).map((a) => a.name);
    assert.deepEqual((await live()).sort(), ["probador", "revisor"]);
    const skills = await env.client.call("skills.list", { project: project.id });
    const dep = skills.skills.find((s) => s.name === "despliegue");
    assert.equal(dep?.scope, "project");
    assert.equal(dep?.editable, true);

    // Alta, cambio y baja con Colonia abierto, sin tocar nada en Colonia.
    w(root, ".claude/agents/nuevo.md", "---\nname: Nuevo\n---\nHola.\n");
    await waitFor(async () => (await live()).includes("Nuevo"), "el agente creado en la carpeta");
    w(root, ".claude/agents/nuevo.md", "---\nname: Nuevo cambiado\n---\nHola.\n");
    await waitFor(async () => (await live()).includes("Nuevo cambiado"), "el agente cambiado en la carpeta");
    fs.rmSync(path.join(root, ".claude/agents/nuevo.md"));
    await waitFor(async () => !(await live()).some((n) => n.startsWith("Nuevo")), "el agente borrado de la carpeta");

    // Lo que Colonia cambia vuelve a su fichero de origen; no aparece una copia en .apc.
    const revisor = (await env.client.call("agents.list", {})).agents.find(
      (a) => a.project_id === project.id && a.name === "revisor",
    );
    await env.client.call("agents.update", { agent: revisor?.id ?? "", prompt: "Revisa con lupa." });
    assert.match(fs.readFileSync(path.join(root, ".claude/agents/revisor.md"), "utf8"), /Revisa con lupa\./);
    assert.match(fs.readFileSync(path.join(root, ".claude/agents/revisor.md"), "utf8"), /tools: Read, Grep/);
    assert.ok(!fs.existsSync(path.join(root, ".apc/agents/revisor.md")));

    // Y la skill, igual.
    await env.client.call("skills.save", {
      name: "despliegue",
      target: "project",
      project: project.id,
      content: "---\nname: despliegue\ndescription: Cómo se despliega\n---\nPasos nuevos.\n",
    });
    assert.match(fs.readFileSync(path.join(root, ".claude/skills/despliegue/SKILL.md"), "utf8"), /Pasos nuevos/);
    assert.ok(!fs.existsSync(path.join(root, ".apc/skills/despliegue")));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
