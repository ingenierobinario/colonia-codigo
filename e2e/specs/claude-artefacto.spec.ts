import { claudeArtifactPage } from "../../packages/protocol/src/claude-artifact.ts";
import { expect, rpc, test } from "./kit.ts";

test("un artefacto privado de Claude se abre desde Aplicaciones internas", async ({ page }) => {
  await rpc("setup.finish", {});
  const url = "https://claude.ai/code/artifact/prueba-interna";
  const app = await rpc<{ id: string }>("surfaces.show", {
    name: "monitor-claude",
    title: "Monitor de Claude",
    app: true,
    html: claudeArtifactPage(url),
  });
  await page.goto(`/#app=${app.id}`);
  const link = page.getByRole("link", { name: "Abrir artefacto en Claude" });
  await expect(link).toHaveAttribute("href", url, { timeout: 30000 });
  await expect(link).toBeVisible();
  await page.reload();
  await expect(link).toHaveAttribute("href", url, { timeout: 30000 });
});
