import { expect, open, openSettings, rpc, test } from "./kit.ts";

// SESIONES-EXTERNAS-1: «Ver cuánto me queda» no puede aplastar el nombre del CLI.
for (const width of [768, 960, 1200, 1440]) {
  test(`sesiones externas: el nombre no se aplasta a ${width}`, async ({ page }, info) => {
    await rpc("setup.finish");
    await page.setViewportSize({ width: 1200, height: 900 });
    await open(page);
    await openSettings(page);
    const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
    await settings.getByRole("button", { name: "Sesiones externas", exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const cards = settings.locator(".engine");
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      const name = card.locator(".engine__name");
      const fits = await name.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, sw: el.scrollWidth };
      });
      expect(fits.sw).toBeLessThanOrEqual(fits.w + 1);
      expect(fits.h).toBeLessThan(30);
      const top = await card.locator(".engine__top").boundingBox();
      // Un CLI sin instalar no lleva «Ver cuánto me queda» (2.36.44): no hay nada que medir.
      const block = card.locator(".engine__usage");
      const usage = (await block.count()) ? await block.boundingBox() : null;
      if (top && usage) expect(usage.y).toBeGreaterThanOrEqual(top.y + top.height);
    }
    await page.screenshot({ path: info.outputPath(`sesiones-${width}.png`) });
  });
}
