// "Sin pedir permiso" (DECISIONS.md#d-193): the chat header puts its project on Total after a confirmation, shows it,
// and gives back the mode the project had.
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("the chat's switch puts its project on Total after confirming, and turning it off gives back its mode", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await using folder = tempDir("colonia-e2e-noask-");
  const repo = folder.path;
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  await rpc("projects.update", { project, autonomy: "manual" });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", project_id: project });
  const mode = async () =>
    (await rpc<{ projects: Array<{ id: string; autonomy?: string }> }>("projects.list")).projects.find(
      (p) => p.id === project,
    )?.autonomy;

  await open(page, `#thread=${chat.id}`);
  const toggle = page.getByTestId("no-ask-switch");
  await expect(toggle).toHaveText("Sin pedir permiso");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Cancelling the confirmation changes nothing.
  await toggle.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("sin esperar tu OK");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await mode()).toBe("manual");

  await toggle.click();
  await page.getByRole("dialog").getByRole("button", { name: "Trabajar sin pedir permiso" }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveText("Sin pedir permiso: activado");
  expect(await mode()).toBe("total");

  // Off goes straight back to what the project had, no confirmation.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await mode()).toBe("manual");
});
