import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

test("desde Ajustes se elige un proyecto y se puede volver a la copia de toda la Colonia", async ({ page }) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Equipo de restauración 209" });
  try {
    await rpc("setup.finish");
    await page.addInitScript(() => localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" })));
    await open(page, "#view=equipos");
    await page.locator(".eq-transfer").getByRole("button", { name: "Copia y traslado" }).click();
    const create = page.locator("[data-bk=create]");
    const scope = create.getByRole("combobox", { name: "Qué quieres copiar" });
    await expect(scope).toHaveText("Toda mi Colonia");
    const include = create.getByRole("checkbox", { name: /documentos y código/ });
    await include.check();
    await scope.click();
    await page.getByRole("option", { name: project.name, exact: true }).click();
    await expect(scope).toHaveText(project.name);
    await expect(include).toHaveCount(0);
    await scope.click();
    await page.getByRole("option", { name: "Toda mi Colonia", exact: true }).click();
    await expect(include).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Nuevo proyecto" }).first().click();
    await page.getByRole("button", { name: "Importar proyecto" }).click();
    await page.getByRole("button", { name: "Restaurar una copia privada .colonia" }).click();
    await expect(page.locator(".bk-card").first()).toHaveAttribute("data-bk", "restore");
  } finally {
    await rpc("projects.unregister", { project: project.id });
  }
});

async function checkLayout(card: Locator) {
  await expect
    .poll(() =>
      card.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          [
            ...el.querySelectorAll<HTMLElement>(
              "h3, label, button, .bk-hint, .bk-project-name, .bk-path__text, .bk-count__label, .bk-review__from, .bk-scope .colonia-select__value",
            ),
          ].every((item) => {
            const rect = item.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 &&
              rect.right <= bounds.right + 1 &&
              item.scrollWidth <= item.clientWidth + 1 &&
              item.scrollHeight <= item.clientHeight + 1
            );
          })
        );
      }),
    )
    .toBe(true);
}

for (const language of ["es", "en"] as const) {
  test(`copia privada de un proyecto desde Compartir y restauración en una carpeta nueva · ${language}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const es = language === "es";
    await rpc("setup.finish");
    const name = `Proyecto privado ${"internacional".repeat(4)} ${language}`;
    const { project } = await rpc<Result<"projects.create">>("projects.create", { name });
    const root = (await world.info()).dir;
    const folder = fs.mkdtempSync(path.join(root, "copias-privadas-"));
    const password = "solo-para-esta-prueba-209";
    const source = project.path;
    if (!source) throw new Error("Falta la carpeta temporal del proyecto");
    fs.writeFileSync(path.join(source, "informe.txt"), "Informe de origen");
    await page.addInitScript(
      ({ language, id }) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language, projectOrder: [id] }));
      },
      { language, id: project.id },
    );
    let importedId: string | undefined;
    try {
      await open(page, `#project=${project.id}`);
      await page.getByRole("group", { name, exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: es ? "Compartir proyecto" : "Share project" }).click();
      const settingsReady = page.waitForResponse("**/rpc/backup.status");
      await page.getByRole("button", { name: es ? "Crear copia privada" : "Create private backup" }).click();
      await settingsReady;
      const create = page.locator("[data-bk=create]");
      await expect(create.getByRole("combobox")).toContainText(name);
      await expect(create.locator("input[type=checkbox]")).toHaveCount(0);
      await create.locator("[name=backup-folder]").fill(folder);
      await create.locator("[name=backup-password]").fill(password);
      await create.locator("[name=backup-password-again]").fill(password);
      const sent = page.waitForRequest("**/rpc/backup.create");
      await create.locator("[data-bk=create-go]").click();
      expect((await sent).postDataJSON()).toEqual({ password, folder, project_id: project.id });
      const archive = create.locator(".bk-path__text");
      await expect(archive).toBeVisible();
      const file = await archive.textContent();
      if (!file || !fs.statSync(file).isFile()) throw new Error("Falta la copia cifrada");
      const restore = page.locator("[data-bk=restore]");
      const select = restore.getByRole("combobox");
      if (await select.count()) {
        await select.click();
        await page.getByRole("option", { name: es ? "Otro archivo…" : "Another file…" }).click();
      }
      await restore.locator("[name=backup-file]").fill(file);
      await restore.locator("[name=backup-restore-password]").fill(password);
      await restore.locator("[data-bk=inspect-go]").click();
      await expect(restore.locator(".bk-project-name")).toHaveText(name);
      await expect(restore.getByRole("radio")).toHaveCount(0);
      for (const mode of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: mode });
        await expect(page.locator(".colonia[data-colonia-mode]").first()).toHaveAttribute("data-colonia-mode", mode);
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await checkLayout(create);
          await checkLayout(restore);
        }
      }
      const destination = path.join(folder, "restaurados");
      fs.mkdirSync(destination);
      await restore.locator("[name=backup-project-destination]").fill(destination);
      const applying = page.waitForRequest("**/rpc/backup.restore");
      await restore.locator("[data-bk=restore-go]").click();
      expect((await applying).postDataJSON()).toEqual({ file, password, mode: "merge", destination });
      await expect(restore.locator("[data-bk=project-restored], [role=alert]")).toBeVisible();
      await expect(restore.getByRole("alert")).toHaveCount(0);
      await restore.getByRole("button", { name: es ? "Abrir proyecto" : "Open project" }).click();
      await expect
        .poll(() => {
          const next = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("project");
          return Boolean(next && next !== project.id);
        })
        .toBe(true);
      const id = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("project");
      if (!id) throw new Error("No se abrió el proyecto restaurado");
      importedId = id;
      const copy = (await rpc<Result<"projects.list">>("projects.list", {})).projects.find((p) => p.id === id);
      expect(copy?.path && path.dirname(copy.path)).toBe(destination);
      expect(fs.readFileSync(path.join(copy?.path ?? "", "informe.txt"), "utf8")).toBe("Informe de origen");
      expect(fs.readFileSync(path.join(source, "informe.txt"), "utf8")).toBe("Informe de origen");
    } finally {
      if (importedId) await rpc("projects.unregister", { project: importedId });
      await rpc("projects.unregister", { project: project.id });
    }
  });
}
