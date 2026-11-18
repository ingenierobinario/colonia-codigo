import type { Page } from "@playwright/test";
import { test as base, expect, rpc } from "./kit.ts";

type Target = "navegador" | "webapp";
type Gate = ReturnType<typeof Promise.withResolvers<void>>;
const id = "apertura-de-prueba";
const appUrl = "https://pizarra.invalid/inicio";
const views = {
  navegador: { module: "NavegadorScreen", method: "navegadores.list", selector: ".navegador__name" },
  webapp: { module: "WebAppScreen", method: "webapps.list", selector: ".webapp__where" },
};

async function openPinned(page: Page, target: Target, screen: Gate, docks: Gate, quota: Gate) {
  await rpc("setup.finish");
  const view = views[target];
  const reads: string[] = [];
  const held = new Set<string>();
  const modules = /\/assets\/(NavegadorScreen|WebAppScreen|NavegadoresDock|WebAppsDock)-[\w-]+\.js$/;
  await page.route(modules, async (route) => {
    const module = modules.exec(route.request().url())?.[1];
    if (module) held.add(module);
    await (module === view.module ? screen : docks).promise;
    await route.continue();
  });
  await page.route(/\/rpc\/(navegadores|webapps)\.list$/, async (route) => {
    const method = new URL(route.request().url()).pathname.slice("/rpc/".length);
    reads.push(method);
    const result =
      method === "navegadores.list"
        ? { navegadores: [{ id, browser: "chrome", name: "Perfil de prueba" }] }
        : { apps: [{ id, name: "Pizarra de prueba", url: appUrl }], keyed: [] };
    await route.fulfill({ json: { ok: true, result } });
  });
  await page.route("**/rpc/browser.open", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: { tab: "prueba", url: appUrl, title: "Pizarra", profile: `app:${id}`, control: { kind: "idle" } },
      },
    }),
  );
  await page.route("**/rpc/engines.usage", async (route) => {
    await quota.promise;
    await route.fulfill({ json: { ok: true, result: { checked_at: "2026-01-01T12:00:00.000Z", engines: [] } } });
  });
  await page.addInitScript((selector) => {
    if (location.protocol === "about:") return;
    localStorage.setItem(
      "colonia.prefs",
      JSON.stringify({ language: "es", sidebarCollapsed: false, appsFolded: false, appsExternalFolded: false }),
    );
    Object.assign(window, { coloniaDesktop: { platform: "win32", setBrowserBounds() {}, showBrowserTab() {} } });
    const fetchPanel = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.pathname === "/rpc/engines.usage") {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        performance.mark(box?.width && box.height ? "cuota-con-vista" : "cuota-sin-vista");
      }
      return fetchPanel(input, init);
    };
  }, view.selector);
  await page.goto(`/#${target}=${id}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => held.has(view.module)).toBe(true);
  const usage = page.getByTestId("engine-usage-button");
  await expect(usage).toBeVisible();
  return { reads, held, usage, showScreen: screen.resolve, showDocks: docks.resolve, showQuota: quota.resolve };
}

const test = base.extend<{ open: (target: Target) => ReturnType<typeof openPinned> }>({
  open: async ({ page }, use) => {
    const screen = Promise.withResolvers<void>();
    const docks = Promise.withResolvers<void>();
    const quota = Promise.withResolvers<void>();
    try {
      await use((target) => openPinned(page, target, screen, docks, quota));
    } finally {
      screen.resolve();
      docks.resolve();
      quota.resolve();
      await page.goto("about:blank");
      await page.unrouteAll({ behavior: "wait" });
    }
  },
});

for (const target of ["navegador", "webapp"] as const) {
  test(`pide el catálogo de ${target} mientras llega su pantalla y consulta las cuotas después de mostrarla`, async ({
    page,
    open,
  }) => {
    const view = views[target];
    const { reads, held, usage, showScreen, showDocks, showQuota } = await open(target);
    await expect.poll(() => [...reads]).toEqual([view.method]);
    expect([...held][0]).toBe(view.module);
    await expect(page.locator(view.selector)).toHaveCount(0);
    expect(await page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(0);
    showScreen();
    await expect(page.locator(view.selector)).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("cuota-con-vista").length)).toBe(1);
    await expect(usage).toHaveAttribute("aria-busy", "true");
    showQuota();
    await expect(usage).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(0);
    showDocks();
    await expect.poll(() => [...reads].sort()).toEqual(["navegadores.list", "webapps.list"]);
  });
}

test("el usuario puede pedir las cuotas mientras el perfil del navegador sigue cargando", async ({ page, open }) => {
  const { usage, showQuota } = await open("navegador");
  expect(await page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(0);
  await usage.click();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(1);
  showQuota();
  await expect(page.getByTestId("engine-usage-summary")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(views.navegador.selector)).toHaveCount(0);
});

test("salir de la aplicación anclada reanuda las cuotas aunque su módulo siga en tránsito", async ({ open, page }) => {
  const { usage, showQuota } = await open("webapp");
  expect(await page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(0);
  await page.getByRole("button", { name: "Tareas", exact: true }).click();
  await expect(page).toHaveURL(/#view=tasks$/);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("cuota-sin-vista").length)).toBe(1);
  showQuota();
  await expect(usage).toHaveAttribute("aria-busy", "false");
});
