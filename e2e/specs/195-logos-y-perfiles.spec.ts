import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const) {
  test(`editar el logo y abrir el perfil original en ${language}`, async ({ page }) => {
    const name = `Logo de prueba ${language}`;
    await rpc("setup.finish");
    await rpc("surfaces.show", { name: `logo-${language}`, title: name, html: "<p>Colonia</p>", app: true });
    await rpc("navegadores.set", { id: "chrome-profile-2", navegador: { name: "Trabajo", browser: "chrome" } });
    await page.addInitScript((lang) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language: lang }));
      const source = { id: "chrome:Profile 2", navegador: "chrome", perfil: "Profile 2" };
      Object.assign(window, {
        coloniaDesktop: {
          platform: "win32",
          async importSources() {
            return [source];
          },
          async bookmarkBar() {
            return [];
          },
          async openOriginalProfile(id: string) {
            document.body.dataset.profileOpened = id;
            return true;
          },
        },
      });
    }, language);
    await page.goto("/");
    const app = page.getByRole("button", { name, exact: true }).first();
    await app.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Propiedades|Properties/ }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(name) });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
      "base64",
    );
    await dialog.locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    const logo = dialog.locator(".artprops__logo img");
    await expect(logo).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await dialog.locator(".artprops__logo").evaluate((el) => {
            const b = el.getBoundingClientRect();
            const items = [...el.querySelectorAll("img,button")].map((i) => i.getBoundingClientRect());
            return items.every(
              (r, i) =>
                r.left >= b.left - 1 &&
                r.right <= b.right + 1 &&
                items
                  .slice(i + 1)
                  .every(
                    (s) =>
                      r.right <= s.left + 1 || r.bottom <= s.top + 1 || s.right <= r.left + 1 || s.bottom <= r.top + 1,
                  ),
            );
          }),
        ).toBe(true);
      }
    }
    await dialog.getByRole("button", { name: /Quitar logo|Remove logo/ }).click();
    await expect(logo).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.goto("/#navegador=chrome-profile-2");
    const original = page.getByRole("button", { name: /Abrir mi perfil|Open my profile/ });
    await original.click();
    await expect(page.locator("body")).toHaveAttribute("data-profile-opened", "chrome:Profile 2");
  });
}
