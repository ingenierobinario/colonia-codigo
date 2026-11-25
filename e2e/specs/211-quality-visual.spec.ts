import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});

for (const language of ["en", "es"]) {
  for (const mode of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      test(`Main screens remain usable: ${language}, ${mode}, ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 850 });
        await page.addInitScript((language) => {
          const prefs = JSON.parse(localStorage.getItem("colonia.prefs") ?? "{}");
          localStorage.setItem("colonia.prefs", JSON.stringify({ ...prefs, language }));
        }, language);
        await open(page);
        await page
          .locator(".colonia")
          .first()
          .evaluate((el, mode) => el.setAttribute("data-colonia-mode", mode), mode);
        for (const [view, selector] of Object.entries({
          tasks: ".page--tasks",
          resources: ".resv",
          files: ".sharedf",
          flows: ".flows",
          computers: ".computers",
          equipos: ".equipos",
        })) {
          await page.evaluate((view) => {
            location.hash = `view=${view}`;
          }, view);
          await expect(page.locator(`main ${selector}`)).toBeVisible();
          await expect(page.locator("main .screen-loading")).toHaveCount(0);
          // Screens have independent data requests after the route chunk mounts. Capture the settled view.
          await page.waitForLoadState("networkidle");
          await expect(page.locator("main")).not.toBeEmpty();
          const overflow = await page.locator("main").evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(overflow, `${view} must fit horizontally`).toBeLessThanOrEqual(1);
          await page.screenshot({ path: info.outputPath(`${view}.png`) });
        }
        await page.keyboard.press("ControlOrMeta+,");
        const dialog = page.getByRole("dialog").last();
        await expect(dialog).toBeVisible();
        await page.waitForLoadState("networkidle");
        const bounds = await dialog.boundingBox();
        if (!bounds) throw new Error("Settings dialog is not visible");
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        await page.screenshot({ path: info.outputPath("settings.png") });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });
    }
  }
}
