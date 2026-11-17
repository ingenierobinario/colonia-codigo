import { expect, rpc, test } from "./kit.ts";

for (const target of ["navegador", "webapp"] as const) {
  test(`abre el enlace directo a un ${target} antes de cargar las secciones de la barra lateral`, async ({ page }) => {
    await rpc("setup.finish");
    const id = "acme-directo";
    await rpc("navegadores.set", { id, navegador: { browser: "chrome", name: "Perfil de pruebas" } });
    await rpc("webapps.set", { id, app: { name: "Aplicación de pruebas", url: "https://acme.example/inicio" } });
    await page.addInitScript(() => {
      const prefs = JSON.parse(localStorage.getItem("colonia.prefs") ?? "{}");
      localStorage.setItem(
        "colonia.prefs",
        JSON.stringify({ ...prefs, sidebarCollapsed: false, appsFolded: false, appsExternalFolded: false }),
      );
      Object.assign(window, { coloniaDesktop: { platform: "win32", setBrowserBounds() {}, showBrowserTab() {} } });
    });
    const release = Promise.withResolvers<void>();
    const held = new Set<string>();
    const reads = new Map<string, number>();
    page.on("request", (req) => {
      const resource = new URL(req.url()).pathname;
      if (resource === "/rpc/navegadores.list" || resource === "/rpc/webapps.list")
        reads.set(resource, (reads.get(resource) ?? 0) + 1);
    });
    await page.route(/\/assets\/(?:NavegadoresDock|WebAppsDock)-[^/]+\.js$/, async (route) => {
      held.add(route.request().url());
      await release.promise;
      await route.continue();
    });
    // El navegador del proyecto es simulado y no visita el dominio de la aplicación.
    await page.route("**/rpc/browser.open", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            tab: "t-acme",
            url: "https://acme.example/inicio",
            title: "Acme",
            profile: `app:${id}`,
            control: { kind: "idle" },
          },
        },
      }),
    );
    try {
      await page.goto(`/#${target}=${id}`, { waitUntil: "domcontentloaded" });
      await expect.poll(() => held.size).toBe(2);
      if (target === "navegador") {
        await expect(page.locator(".navegador__name")).toContainText("Perfil de pruebas");
      } else {
        await expect(page.locator(".webapp__where")).toHaveAttribute("title", "https://acme.example/inicio");
      }
      const selected = target === "navegador" ? "/rpc/navegadores.list" : "/rpc/webapps.list";
      expect(Object.fromEntries(reads)).toEqual({ [selected]: 1 });
      release.resolve();
      await expect
        .poll(() => Object.fromEntries(reads))
        .toEqual({ "/rpc/navegadores.list": 1, "/rpc/webapps.list": 1 });
      await expect(
        page.locator(".sidebar").getByRole("button", { name: "Aplicación de pruebas", exact: true }),
      ).toBeVisible();
      expect(reads.get(selected)).toBe(1);
    } finally {
      release.resolve();
      await rpc("navegadores.set", { id, navegador: null });
      await rpc("webapps.set", { id, app: null });
    }
  });
}

for (const language of ["es", "en"] as const) {
  test(`un fallo al cargar cada lista permite reintentar sin declarar que se ha quitado el recurso · ${language}`, async ({
    page,
  }) => {
    await rpc("setup.finish");
    await page.addInitScript(
      (language) => localStorage.setItem("colonia.prefs", JSON.stringify({ language })),
      language,
    );
    for (const target of ["navegador", "webapp"] as const) {
      const endpoint = target === "navegador" ? "**/rpc/navegadores.list" : "**/rpc/webapps.list";
      let fail = true;
      await page.route(endpoint, (route) =>
        route.fulfill({
          json: fail
            ? { ok: false, error: { code: "unavailable", message: "Lista no disponible", retryable: true } }
            : { ok: true, result: target === "navegador" ? { navegadores: [] } : { apps: [], keyed: [] } },
        }),
      );
      await page.goto(`/#${target}=prueba-sin-recurso`);
      // Un enlace nuevo puede compartir documento con la ruta anterior.
      await page.reload();
      const retry = page.getByRole("main").getByRole("button", { name: language === "es" ? "Reintentar" : "Retry" });
      await expect(retry).toBeVisible();
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await retry.evaluate((button) => {
              const label = button.querySelector<HTMLElement>(".colonia-btn__label");
              const box = button.getBoundingClientRect();
              return (
                !!label &&
                label.scrollWidth <= label.clientWidth + 1 &&
                box.left >= -1 &&
                box.right <= innerWidth + 1 &&
                document.documentElement.scrollWidth <= innerWidth + 1
              );
            }),
            `${target} · ${language} · ${colorScheme} · ${width}`,
          ).toBe(true);
        }
      }
      fail = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole("main").locator(".colonia-empty")).toBeVisible();
      await page.unroute(endpoint);
    }
  });
}
