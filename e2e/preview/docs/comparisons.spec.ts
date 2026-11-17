import { expect, test } from "@playwright/test";

for (const lang of ["es", "en"] as const) {
  const pre = lang === "es" ? "/es" : "";
  const home = lang === "es" ? "/" : "/en/";
  for (const [slug, title] of [
    ["concepts/agents", lang === "es" ? "Agentes" : "Agents"],
    ["office/chat", "Chat"],
    ["start/install", lang === "es" ? "Instalación" : "Install"],
  ] as const) {
    test(`${lang}: la guía ${slug} muestra contenido, imágenes y enlaces de sección`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(`${pre}/docs/${slug}/`);
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      const sections = page.locator("main h2[id]");
      expect(await sections.count()).toBeGreaterThan(1);
      const id = await sections.nth(1).getAttribute("id");
      await page.goto(`${pre}/docs/${slug}/#${id}`);
      await expect(sections.nth(1)).toBeInViewport();
      for (const img of await page.locator("main img:visible").all()) {
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
  test(`${lang}: el menú de documentación enlaza guías del idioma elegido`, async ({ page, request, isMobile }) => {
    await page.goto(home);
    if (isMobile) await page.locator(".nav__toggle").click();
    else await page.locator(".nav__docs-link").focus();
    const guide = page.locator(".nav__docs .nav__menu-list--docs a");
    await expect(guide).toHaveCount(6);
    for (const link of await guide.all()) {
      const href = (await link.getAttribute("href")) ?? "";
      expect(href).toMatch(new RegExp(`^${pre}/docs/`));
      expect((await request.get(href)).status()).toBe(200);
    }
    await guide.first().click();
    await expect(page).toHaveURL(`${pre}/docs/concepts/agents/`);
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`los ojos aparecen junto con la imagen del pingüino · ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/menta.*.webp", async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const blob = page.locator(".web-header .brand .colonia-blob");
      await expect(blob.locator("img")).toHaveAttribute("loading", "lazy");
      await expect(blob.locator("svg")).toBeHidden();
      release();
      await expect(blob.locator("svg")).toBeVisible();
      expect(await blob.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      for (const theme of ["dark", "light"]) {
        if ((await page.locator("html").getAttribute("data-theme")) !== theme) await page.locator("#theme").click();
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const aligned = await blob.evaluate((element) => {
            const body = element.querySelector("img")?.getBoundingClientRect();
            const eyes = element.querySelector("svg")?.getBoundingClientRect();
            return (
              body !== undefined &&
              eyes !== undefined &&
              Math.abs(body.x - eyes.x) <= 1 &&
              Math.abs(body.y - eyes.y) <= 1 &&
              Math.abs(body.width - eyes.width) <= 1 &&
              Math.abs(body.height - eyes.height) <= 1 &&
              document.documentElement.scrollWidth <= innerWidth + 1
            );
          });
          expect(aligned, `${width} · ${theme}`).toBe(true);
        }
      }
    } finally {
      release();
    }
  });
}

test("si la imagen falla no quedan ojos flotando", async ({ page }) => {
  await page.route("**/menta.*.webp", (route) => route.abort());
  await page.goto("/");
  const blob = page.locator(".web-header .brand .colonia-blob");
  await expect(blob.locator("img")).toHaveJSProperty("complete", true);
  await expect(blob.locator("img")).toHaveJSProperty("naturalWidth", 0);
  await expect(blob.locator("svg")).toBeHidden();
});
