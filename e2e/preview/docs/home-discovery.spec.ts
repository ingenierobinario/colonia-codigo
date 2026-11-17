import { expect, test } from "@playwright/test";

for (const lang of ["es", "en"] as const) {
  const home = lang === "es" ? "/" : "/en/";
  test(`${lang}: las preguntas frecuentes se recorren con el teclado en ambos temas`, async ({ page }) => {
    await page.goto(home);
    await page
      .locator(".web-footer")
      .getByRole("link", { name: lang === "es" ? "Preguntas" : "Questions", exact: true })
      .click();
    await expect(page).toHaveURL(`${home}#questions`);
    const questions = page.locator("#questions details");
    await expect(questions).toHaveCount(7);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const item of await questions.all()) {
        await item.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(item.locator(".home-questions__answer p")).toBeVisible();
        await expect(item.locator(".home-questions__answer p")).toHaveText(/\S/);
        await page.keyboard.press("Space");
        await expect(item).not.toHaveAttribute("open", "");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()?.width);
    }
  });

  test(`${lang}: la invitación final ofrece reservar y volver a las funciones`, async ({ page }) => {
    await page.goto(home);
    const final = page.locator("main > #questions + .final:last-child");
    await expect(final).toHaveCount(1);
    await expect(page.locator("main:has(> .final:last-child) + .web-footer")).toHaveCount(1);
    await expect(final.getByRole("heading", { level: 2 })).toHaveText(
      lang === "es" ? "Tu colonia te espera." : "Your colony is waiting.",
    );
    await expect(final.locator(".parade .colonia-blob")).toHaveCount(35);
    const reserve = final.getByRole("link", { name: lang === "es" ? "Quiero mi colonia" : "I want my Colonia" });
    await expect(reserve).toHaveAttribute("href", (await page.locator("#heroReserve").getAttribute("href")) ?? "");
    await final.locator(".btn-ghost").click();
    await expect(page).toHaveURL(`${home}#what`);
    await expect(page.locator("#what h2")).toBeInViewport();
  });
}
