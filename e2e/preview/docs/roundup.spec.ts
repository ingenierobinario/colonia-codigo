import { expect, test } from "@playwright/test";

for (const lang of ["es", "en"] as const) {
  const pre = lang === "es" ? "/es" : "";
  const home = lang === "es" ? "/" : "/en/";
  test(`${lang}: la introducción permite continuar con instalación y primeros pasos`, async ({ page }) => {
    await page.goto(`${pre}/docs/start/introduction/`);
    const content = page.locator("main .sl-markdown-content");
    for (const [route, title] of [
      ["install", lang === "es" ? "Instalación" : "Install"],
      ["first-steps", lang === "es" ? "Primeros pasos" : "First steps"],
    ] as const) {
      await content.locator(`a[href$="/start/${route}/"]`).first().click();
      await expect(page).toHaveURL(`${pre}/docs/start/${route}/`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await page.goBack();
    }
  });

  test(`${lang}: los metadatos de la portada apuntan a sus dos idiomas`, async ({ page }) => {
    await page.goto(home);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    for (const [language, route] of [
      ["es", "/"],
      ["en", "/en/"],
    ] as const) {
      const link = page.locator(`link[rel="alternate"][hreflang="${language}"]`);
      const href = await link.getAttribute("href");
      expect(new URL(href ?? "").pathname).toBe(route);
      await expect(page.locator(`.nav__cta a[hreflang="${language}"]`)).toHaveAttribute("href", route);
    }
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical ?? "").pathname).toBe(home);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
