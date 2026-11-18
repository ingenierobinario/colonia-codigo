import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const) {
  test(`incluye archivos externos sólo cuando se marcan · ${language}`, async ({ page }) => {
    await rpc("setup.finish");
    await page.addInitScript((language) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
    }, language);
    await page.goto("/#view=equipos");
    await page
      .locator(".eq-transfer")
      .getByRole("button", { name: language === "es" ? "Copia y traslado" : "Backup & transfer" })
      .click();
    const card = page.locator("[data-bk=create]");
    const option = card.getByRole("checkbox", {
      name: language === "es" ? /documentos y código/ : /documents and code/,
    });
    await expect(option).not.toBeChecked();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator(".colonia[data-colonia-mode]").first()).toHaveAttribute(
        "data-colonia-mode",
        colorScheme,
      );
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await option.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            option.evaluate((node) => {
              const label = node.closest("label");
              const text = label?.querySelector(".colonia-choice__label");
              if (!label || !text) return false;
              const box = label.getBoundingClientRect();
              return (
                box.left >= 0 &&
                box.right <= innerWidth + 1 &&
                text.scrollWidth <= text.clientWidth + 1 &&
                document.documentElement.scrollWidth <= innerWidth + 1
              );
            }),
          )
          .toBe(true);
      }
    }
    await option.check();
    await card.locator("input[name=backup-password]").fill("prueba-local-203");
    await card.locator("input[name=backup-password-again]").fill("prueba-local-203");
    await page.route("**/rpc/backup.create", (route) =>
      route.fulfill({
        json: { ok: true, result: { state: "done", kind: "create", done: 0, total: 0, folder: "/ejemplo" } },
      }),
    );
    const sent = page.waitForRequest("**/rpc/backup.create");
    await card.locator("[data-bk=create-go]").click();
    expect((await sent).postDataJSON().include_work).toBe(true);
  });
}
