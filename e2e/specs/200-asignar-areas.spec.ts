import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

const area = "Atención a clientes y distribución internacional";
const role = "Coordinación de solicitudes internacionales y seguimiento de pedidos";
for (const language of ["es", "en"] as const) {
  test(`asigna, cambia y quita el área y el rol desde el equipo en ${language}`, async ({ page }) => {
    await rpc("setup.finish");
    const { project } = await rpc<Result<"projects.create">>("projects.create", {
      name: `Equipo ${language}`,
      kind: "company",
    });
    const agent = await rpc<Result<"agents.create">>("agents.create", {
      project_id: project.id,
      slug: "azul",
      name: "Azul",
      role: "Consultoría editorial",
    });
    await rpc("agents.create", { project_id: project.id, slug: "rojo", name: "Rojo", role: "" });
    await rpc("org.set", {
      project: project.id,
      organization: {
        areas: [
          { slug: "atencion", name: area },
          { slug: "compras", name: "Compras" },
        ],
        roles: [
          { slug: "coordinacion", name: role, area: "atencion" },
          { slug: "apoyo", name: "Apoyo" },
        ],
      },
    });
    await page.addInitScript(
      (language) => localStorage.setItem("colonia.prefs", JSON.stringify({ language })),
      language,
    );
    await page.goto(`/#project=${project.id}&tab=team`);
    await page
      .locator(".team__tabs")
      .getByRole("tab", { name: /áreas y roles|areas and roles/i })
      .click();
    const card = page.locator(".org__area").filter({ has: page.getByText(area, { exact: true }) });
    await card.getByRole("button", { name: /asignar agente|assign agent/i }).click();
    const dialog = page.getByRole("dialog");
    const pick = async (name: RegExp, option: string) => {
      await dialog.getByRole("combobox", { name }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await expect(dialog.getByRole("button", { name: /guardar|save/i })).toBeDisabled();
    await dialog.getByRole("combobox", { name: /^agente?$/i }).click();
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.getByRole("option", { name: "Azul" }).click();
    await expect(dialog.getByRole("combobox", { name: /^role?$/i })).toHaveText("Consultoría editorial");
    await pick(/^role?$/i, role);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await dialog.getByRole("combobox", { name: /^role?$/i }).click();
        const option = page.getByRole("option", { name: role, exact: true });
        await expect(option).toBeVisible();
        const optionFits = await option.evaluate((el) => {
          const label = el.querySelector<HTMLElement>(".colonia-menu__text");
          const box = el.getBoundingClientRect();
          return (
            !!label &&
            label.scrollWidth <= label.clientWidth + 1 &&
            label.scrollHeight <= label.clientHeight + 1 &&
            box.left >= 0 &&
            box.right <= innerWidth + 1
          );
        });
        expect(optionFits, `opción ${language} ${colorScheme} ${width}`).toBe(true);
        await page.keyboard.press("Escape");
        const fits = await dialog.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return {
            dialog: box.left >= 0 && box.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1,
            controls: [...el.querySelectorAll<HTMLElement>(".colonia-select__value")].every(
              (field) => field.scrollWidth <= field.clientWidth + 1 && field.scrollHeight <= field.clientHeight + 1,
            ),
            cards: [
              ...document.querySelectorAll<HTMLElement>(".org, .org__area, .org__roles .colonia-btn__label"),
            ].every((item) => item.scrollWidth <= item.clientWidth + 1),
            page: document.documentElement.scrollWidth <= innerWidth + 1,
          };
        });
        expect(fits, `${language} ${colorScheme} ${width}`).toEqual({
          dialog: true,
          controls: true,
          cards: true,
          page: true,
        });
      }
    }
    await dialog.getByRole("button", { name: /guardar|save/i }).click();
    const assigned = card.getByRole("button", { name: `Azul ${role}` });
    await expect(assigned).toBeVisible();
    await expect(card.locator(".org__count")).toHaveText(/1 agent/);
    await assigned.click();
    await pick(/^(área|area)$/i, "Compras");
    await dialog.getByRole("combobox", { name: /^role?$/i }).click();
    await expect(page.getByRole("option", { name: role })).toHaveCount(0);
    await page.getByRole("option", { name: "Apoyo" }).click();
    await dialog.getByRole("button", { name: /guardar|save/i }).click();
    const moved = page.locator(".org__area").filter({ hasText: "Compras" });
    await moved.getByRole("button", { name: "Azul Apoyo" }).click();
    await pick(/^(área|area)$/i, language === "es" ? "Sin área" : "No area");
    await pick(/^role?$/i, language === "es" ? "Sin rol" : "No role");
    await dialog.getByRole("button", { name: /guardar|save/i }).click();
    await expect(dialog).toHaveCount(0);
    const stored = await rpc<Result<"agents.get">>("agents.get", { agent: agent.id });
    expect(stored.agent.area).toBeUndefined();
    expect(stored.agent.role).toBe("");
  });
}
