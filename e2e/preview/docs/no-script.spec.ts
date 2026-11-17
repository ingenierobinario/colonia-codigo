import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: legacy documentation redirects without scripts`, async ({ page }) => {
    await page.goto(`${pre}/start/introduction/`);
    await expect(page).toHaveURL(`${pre}/docs/start/introduction/`);
    await expect(page.locator("main h1")).toBeVisible();
  });
}

for (const lang of ["es", "en"] as const) {
  const home = lang === "es" ? "/" : "/en/";
  test(`${lang}: las preguntas y el cambio de idioma funcionan sin JavaScript`, async ({ page }) => {
    await page.goto(home);
    await page.locator(`.web-footer a[href="${home}#questions"]`).click();
    const first = page.locator("#questions details").first();
    await first.locator("summary").click();
    await expect(first.locator(".home-questions__answer")).toBeVisible();
    const next = lang === "es" ? "en" : "es";
    await page.locator(`.lang a[hreflang="${next}"]`).click();
    await expect(page).toHaveURL(next === "es" ? "/" : "/en/");
    await expect(page.locator("html")).toHaveAttribute("lang", next);
  });
}
