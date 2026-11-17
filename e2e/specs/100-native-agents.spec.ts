// AGENTES-NATIVOS-1 · Un proyecto de Claude Code añadido desde su carpeta: sus agentes de .claude/agents y sus skills
// de .claude/skills salen en la vista del proyecto, y un agente creado en la carpeta con Colonia abierto aparece solo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("los agentes y skills de .claude se ven en el proyecto y un agente nuevo en la carpeta aparece en vivo", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "colonia-e2e-claude-")));
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  w("CLAUDE.md", "# Tienda\n\nResponde en español.\n");
  w(".claude/agents/revisor.md", "---\nname: Revisor Tienda\ndescription: Revisa\n---\nRevisa.\n");
  w(".claude/skills/despliegue-tienda/SKILL.md", "---\nname: despliegue-tienda\ndescription: Despliega\n---\nPasos.\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;

  await open(page, `#project=${project}&tab=team`);
  await expect(page.locator(".teamcanvas__node", { hasText: "Revisor Tienda" })).toBeVisible();

  w(".claude/agents/vigia.md", "---\nname: Vigia Tienda\n---\nVigila.\n");
  await expect(page.locator(".teamcanvas__node", { hasText: "Vigia Tienda" })).toBeVisible({ timeout: 15_000 });

  await open(page, `#project=${project}&tab=resources`);
  await page.getByRole("radio", { name: /^Skills/ }).click();
  await expect(page.getByText("despliegue-tienda").first()).toBeVisible();
});
