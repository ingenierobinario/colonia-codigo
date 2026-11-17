import { expect, test } from "@playwright/test";

for (const lang of ["en", "es"] as const) {
  const home = lang === "es" ? "/" : "/en/";
  test(`${lang}: los enlaces del pie llevan a las secciones en el mismo idioma`, async ({ page }) => {
    await page.goto(home);
    const footer = page.locator(".web-footer");
    await expect(footer.locator(".brand")).toHaveAttribute("href", home);
    const nav = footer.getByRole("navigation");
    await expect(nav).toHaveCount(2);
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(6);
    for (const id of ["what", "new", "start", "terminal", "questions"]) {
      const link = nav.locator(`a[href="${home}#${id}"]`);
      await link.click();
      await expect(page).toHaveURL(`${home}#${id}`);
      await expect(page.locator(`#${id} h2`).first()).toBeInViewport();
    }
    await expect(nav.locator("a[href^='https:']")).toHaveAttribute(
      "href",
      (await page.locator("#heroReserve").getAttribute("href")) ?? "",
    );
    await expect(footer.locator(".web-footer__platforms li")).toHaveText(["macOS", "Windows", "Linux"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("el pie mantiene las dos columnas y enlaces táctiles dentro de la pantalla @phone", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator(".web-footer");
  await footer.scrollIntoViewIfNeeded();
  const columns = await footer
    .locator(".web-footer__col")
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
  expect(new Set(columns).size).toBe(2);
  for (const link of await footer.locator(".web-footer__row a").all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  }
});
