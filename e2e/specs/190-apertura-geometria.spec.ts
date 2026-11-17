import { ColoniaClient } from "../../packages/protocol/src/client.ts";
import { expect, rpc, test, world } from "./kit.ts";

test("la aplicación externa muestra la pestaña antes de terminar su apertura", async ({ page }) => {
  await rpc("setup.finish");
  await rpc("webapps.set", { id: "acme-prueba", app: { name: "Acme", url: "https://example.com" } });
  const { core, token } = await world.info();
  const node = await new ColoniaClient({ url: core, token }).connect("node", ["browser"]);
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let calls = 0;
  const tab = {
    tab: "prueba-apertura",
    url: "https://example.com",
    title: "Acme",
    profile: "app:acme-prueba",
    control: { kind: "idle" },
  };
  node.onRequest(async (method) => {
    if (method === "browser.tabs") return { tabs: calls ? [tab] : [] };
    if (method === "browser.open") {
      calls++;
      node.emit("browser", "tabs.changed", { tabs: [tab] });
      started.resolve();
      await release.promise;
      return tab;
    }
    throw new Error(`Petición inesperada: ${method}`);
  });
  try {
    await page.addInitScript(() => {
      Object.assign(window, { coloniaDesktop: { platform: "win32", setBrowserBounds() {}, showBrowserTab() {} } });
    });
    await page.goto("/#webapp=acme-prueba");
    await started.promise;
    await expect(page.locator(".webapp .browser__page--native")).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    release.resolve();
    await page.close();
    node.close();
    await node.closed;
    await rpc("webapps.set", { id: "acme-prueba", app: null });
  }
});

for (const language of ["es", "en"]) {
  for (const mode of ["light", "dark"] as const) {
    for (const width of [390, 768, 960, 1200, 1440]) {
      test(`perfil completo: ${language}, ${mode}, ${width}`, async ({ page }, info) => {
        await rpc("setup.finish");
        const name = "Administración y operaciones internacionales de Acme";
        await rpc("navegadores.set", { id: "acme-perfil", navegador: { browser: "chrome", name } });
        try {
          await page.emulateMedia({ colorScheme: mode });
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript((language) => {
            localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
          }, language);
          await page.goto("/#navegador=acme-perfil");
          const label = page.locator(".navegador__name");
          await expect(label).toHaveText(`Chrome · ${name}`);
          const metrics = await label.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const tabs = document.querySelector(".navegador__tabs")?.getBoundingClientRect();
            if (!tabs) throw new Error("Falta la barra de pestañas");
            return {
              width: el.clientWidth,
              scroll: el.scrollWidth,
              height: el.clientHeight,
              scrollHeight: el.scrollHeight,
              separate: r.right <= tabs.left + 1 || r.bottom <= tabs.top + 1,
              page: document.documentElement.scrollWidth,
              viewport: innerWidth,
            };
          });
          expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
          expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.height + 1);
          expect(metrics.separate).toBe(true);
          expect(metrics.page).toBeLessThanOrEqual(metrics.viewport);
          await expect(
            page.getByRole("textbox", { name: language === "es" ? "Dirección" : "Address", exact: true }),
          ).toBeVisible();
          await page.screenshot({ path: info.outputPath(`perfil-${language}-${mode}-${width}.png`) });
        } finally {
          await rpc("navegadores.set", { id: "acme-perfil", navegador: null });
        }
      });
    }
  }
}
