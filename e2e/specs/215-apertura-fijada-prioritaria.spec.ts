import type { Locator, Page } from "@playwright/test";
import { test as base, expect, rpc } from "./kit.ts";

type Target = "navegador" | "webapp";
type Gate = ReturnType<typeof Promise.withResolvers<void>>;
type OpenOptions = { failure?: "first" | "both"; language?: "en" | "es" };
const id = "apertura-de-prueba";
const appUrl = "https://pizarra.invalid/inicio";
const views = {
  navegador: { module: "NavegadorScreen", method: "navegadores.list", selector: ".navegador__name" },
  webapp: { module: "WebAppScreen", method: "webapps.list", selector: ".webapp__where" },
};
const retryLabels = {
  es: { navegador: "Recargar perfiles", webapp: "Recargar aplicaciones" },
  en: { navegador: "Retry loading profiles", webapp: "Retry loading pinned apps" },
};

async function openPinned(page: Page, target: Target, screen: Gate, docks: Gate, quota: Gate, options: OpenOptions) {
  await rpc("setup.finish");
  const view = views[target];
  const reads: string[] = [];
  let firstReadFinished = false;
  page.on("requestfinished", (request) => {
    if (new URL(request.url()).pathname === `/rpc/${view.method}`) firstReadFinished = true;
  });
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
    const fail =
      options.failure === "both" || (options.failure === "first" && method === view.method && !reads.includes(method));
    reads.push(method);
    if (fail) {
      await route.fulfill({
        json: {
          ok: false,
          error: { code: "unavailable", message: "Catálogo de prueba sin conexión", retryable: true },
        },
      });
      return;
    }
    const result =
      method === "navegadores.list"
        ? { navegadores: [{ id, browser: "chrome", name: "Perfil de prueba" }] }
        : { apps: [{ id, name: "Pizarra de prueba", url: appUrl }], keyed: [] };
    await route.fulfill({ json: { ok: true, result } });
  });
  await page.route(new URL("/favicon.ico", appUrl).href, (route) => route.fulfill({ status: 204 }));
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
  await page.addInitScript(
    ({ selector, language }) => {
      if (location.protocol === "about:") return;
      localStorage.setItem(
        "colonia.prefs",
        JSON.stringify({ language, sidebarCollapsed: false, appsFolded: false, appsExternalFolded: false }),
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
    },
    { selector: view.selector, language: options.language ?? "es" },
  );
  await page.goto(`/#${target}=${id}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => held.has(view.module)).toBe(true);
  if (options.failure) await expect.poll(() => firstReadFinished).toBe(true);
  const usage = page.getByTestId("engine-usage-button");
  await expect(usage).toBeVisible();
  return { reads, held, usage, showScreen: screen.resolve, showDocks: docks.resolve, showQuota: quota.resolve };
}

const test = base.extend<{ open: (target: Target, options?: OpenOptions) => ReturnType<typeof openPinned> }>({
  open: async ({ page }, use) => {
    const screen = Promise.withResolvers<void>();
    const docks = Promise.withResolvers<void>();
    const quota = Promise.withResolvers<void>();
    try {
      await use((target, options = {}) => openPinned(page, target, screen, docks, quota, options));
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

  test(`mantiene el fallo inicial de ${target} hasta que el usuario reintenta desde ${target === "navegador" ? "la barra lateral" : "la pantalla"}`, async ({
    page,
    open,
  }) => {
    const { reads, showScreen, showDocks, showQuota } = await open(target, { failure: "first" });
    const view = views[target];
    expect(reads).toEqual([view.method]);
    showScreen();
    const main = page.getByRole("main");
    const mainRetry = main.getByRole("button", { name: "Reintentar", exact: true });
    await expect(mainRetry).toBeVisible();
    showDocks();
    const sidebar = page.locator(".sidebar");
    const label = target === "navegador" ? "Perfil de prueba" : "Pizarra de prueba";
    const otherLabel = target === "navegador" ? "Pizarra de prueba" : "Perfil de prueba";
    const otherMethod = target === "navegador" ? views.webapp.method : views.navegador.method;
    // La fila de la otra sección confirma que los dos módulos ya han montado sus controles.
    await expect(sidebar.getByRole("button", { name: otherLabel, exact: true })).toBeVisible();
    const dockRetry = sidebar.getByRole("button", {
      name: retryLabels.es[target],
      exact: true,
    });
    await expect(dockRetry).toBeVisible();
    await expect(mainRetry).toBeVisible();
    expect(reads).toEqual([view.method, otherMethod]);

    await (target === "navegador" ? dockRetry : mainRetry).click();
    await expect(sidebar.getByRole("button", { name: label, exact: true })).toBeVisible();
    if (target === "navegador") await expect(main.locator(view.selector)).toContainText(label);
    else await expect(main.locator(view.selector)).toHaveAttribute("title", appUrl);
    await expect(mainRetry).toHaveCount(0);
    await expect(dockRetry).toHaveCount(0);
    expect(reads).toEqual([view.method, otherMethod, view.method]);
    showQuota();
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

async function measureRetry(row: Locator, compact: boolean) {
  await row.scrollIntoViewIfNeeded();
  return row.evaluate((el, compact) => {
    const inside = (child: DOMRect, parent: DOMRect) =>
      child.left >= parent.left - 1 &&
      child.right <= parent.right + 1 &&
      child.top >= parent.top - 1 &&
      child.bottom <= parent.bottom + 1;
    const bounds = el.getBoundingClientRect();
    const icon = el.querySelector("svg")?.getBoundingClientRect();
    const scroll = el.closest<HTMLElement>(".sidebar__scroll");
    const label = el.querySelector<HTMLElement>(".colonia-nav__label");
    const text = label?.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      clickable: !!hit && el.contains(hit),
      rowFits: !!scroll && inside(bounds, scroll.getBoundingClientRect()) && el.scrollWidth <= el.clientWidth + 1,
      iconFits: !!icon && icon.width >= 12 && icon.height >= 12 && inside(icon, bounds),
      labelFits: compact
        ? el.hasAttribute("aria-label") && !label
        : !!label &&
          !!text &&
          !!icon &&
          inside(text, bounds) &&
          text.width > 0 &&
          text.left >= icon.right - 1 &&
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
      noHorizontalScroll:
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        !!scroll &&
        scroll.scrollWidth <= scroll.clientWidth + 1,
    };
  }, compact);
}

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`geometría de ambos reintentos de la barra lateral · ${language} · ${mode}`, async ({ open, page }) => {
      await page.emulateMedia({ colorScheme: mode });
      await page.setViewportSize({ width: 1440, height: 900 });
      const { showScreen, showDocks, showQuota } = await open("navegador", { failure: "both", language });
      showScreen();
      showDocks();
      showQuota();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const sidebar = page.locator(`[data-colonia-mode="${mode}"] .sidebar`);
      for (const width of [1440, 1200, 960, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const compact = width < 1320;
        await expect(sidebar).toHaveClass(compact ? /\bis-rail\b/ : /^sidebar$/);
        for (const name of Object.values(retryLabels[language])) {
          const row = sidebar.getByRole("button", { name, exact: true });
          await expect(row).toBeVisible();
          expect(await measureRetry(row, compact), `${name} · ${mode} · ${width}`).toEqual({
            clickable: true,
            rowFits: true,
            iconFits: true,
            labelFits: true,
            noHorizontalScroll: true,
          });
        }
      }
    });
  }
}

test("los dos reintentos muestran el nombre completo al estrechar la barra y ampliar el espaciado de texto", async ({
  open,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { showScreen, showDocks, showQuota } = await open("navegador", { failure: "both", language: "en" });
  showScreen();
  showDocks();
  showQuota();
  const sidebar = page.locator(".sidebar");
  const handle = sidebar.locator(".sidebar__resize");
  for (let i = 0; i < 3; i++) await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemin")) ?? "");
  await page.addStyleTag({
    content: ".sidebar .colonia-nav__label { letter-spacing: 0.12em; word-spacing: 0.16em }",
  });
  const clipped = [];
  for (const name of Object.values(retryLabels.en)) {
    const row = sidebar.getByRole("button", { name, exact: true });
    await expect(row).toBeVisible();
    const geometry = await measureRetry(row, false);
    const label = await row.locator(".colonia-nav__label").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        lines: new Set(Array.from(range.getClientRects(), (r) => r.top)).size,
        available: el.clientWidth,
        content: el.scrollWidth,
      };
    });
    if (label.lines < 2 || Object.values(geometry).includes(false)) clipped.push({ name, label, geometry });
  }
  expect(clipped, "Ambas filas deben envolver el texto y conservar sus controles dentro de la barra").toEqual([]);
});
