import { expect, test } from "@playwright/test";

test("permite elegir desde el primer render y explica la espera sin cargar el panel principal", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "coloniaConnect", { value: { local: () => new Promise(() => {}) } });
    localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" }));
  });
  await page.goto("/?connect");
  const button = page.locator("#pick-server");
  await button.waitFor();
  expect(await button.evaluate((el) => el.closest("[inert]") === null)).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toContainText("Tu equipo empieza aquí");
  expect(
    await page.evaluate(() => performance.getEntriesByType("resource").some((r) => /\/Shell-[\w-]+\.js/.test(r.name))),
  ).toBe(false);
});

test("un fallo de conexión permite volver a elegir", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "coloniaConnect", {
      value: {
        local: async () => {
          throw new Error("offline");
        },
      },
    });
  });
  await page.goto("/?connect");
  const button = page.locator("#pick-server");
  await button.click();
  await expect(button).toBeEnabled();
  await expect(page.locator("#pick-move")).toBeEnabled();
});
