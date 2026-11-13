// NAVFIX-1: un perfil de Navegadores dentro de la app de escritorio. El navegador es un nodo de mentira con sus
// pestañas (abrir tarda, como una página que carga) y el escritorio un puente de mentira con una barra de marcadores
// larga, que apunta dónde le dicen que va la página nativa.
import type { Page } from "@playwright/test";
import { ColoniaClient } from "../../packages/protocol/src/client.ts";
import { expect, rpc, test, until, world } from "./kit.ts";

const ID = "chrome-alexander";
const PROFILE = `nav:${ID}`;
type Tab = { tab: string; url: string; title: string; profile: string; control: { kind: "idle" } };
type Slot = { x: number; y: number; width: number; height: number } | null;

/** El nodo del navegador: guarda las pestañas, las anuncia al cambiar y tarda `loadMs` en dar por abierta una. */
async function browserNode(loadMs = 0) {
  const { core, token } = await world.info();
  const node = await new ColoniaClient({ url: core, token }).connect("node", ["browser"]);
  let tabs: Tab[] = [];
  let seq = 0;
  let loading = 0;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const announce = () => node.emit("browser", "tabs.changed", { tabs });
  node.onRequest(async (method, raw) => {
    const params = (raw ?? {}) as Record<string, unknown>;
    calls.push({ method, params });
    if (method === "browser.tabs") return { tabs };
    if (method === "browser.open") {
      const url = String(params.url);
      const tab: Tab = {
        tab: `t${++seq}`,
        url,
        title: new URL(url).hostname,
        profile: String(params.profile),
        control: { kind: "idle" },
      };
      tabs = [...tabs, tab];
      // Como el escritorio: la pestaña existe (y se anuncia) antes de que su página termine de cargar.
      announce();
      loading++;
      await new Promise((r) => setTimeout(r, loadMs));
      loading--;
      return tab;
    }
    if (method === "browser.navigate") {
      const url = String(params.url);
      tabs = tabs.map((t) => (t.tab === params.tab ? { ...t, url, title: new URL(url).hostname } : t));
      announce();
      return { url, title: new URL(url).hostname };
    }
    if (method === "browser.close") {
      tabs = tabs.filter((t) => t.tab !== params.tab);
      announce();
      return { ok: true };
    }
    throw new Error(`Unexpected ${method}`);
  });
  return {
    calls: (method: string) => calls.filter((c) => c.method === method).map((c) => c.params),
    /** Ninguna página a medio cargar: cerrar el nodo antes dejaría esas aperturas sin respuesta. */
    idle: async () => loading === 0,
    async close() {
      node.close();
      await node.closed;
    },
  };
}

/** El puente del escritorio: el perfil real con `bookmarks` marcadores en la barra, y dónde se pide la página. */
async function desktop(page: Page, bookmarks: number) {
  await page.addInitScript((count) => {
    const names = ["Correo", "Calendario de reuniones", "Documentación interna del equipo", "GitHub", "Facturas"];
    const bar = Array.from({ length: count }, (_, i) =>
      i % 7 === 3
        ? { titulo: `Carpeta ${i}`, hijos: [{ titulo: `Dentro ${i}`, url: `https://dentro${i}.example.com/` }] }
        : { titulo: `${names[i % names.length]} ${i}`, url: `https://marcador${i}.example.com/` },
    );
    const state = { slot: null as unknown, slots: 0, shown: [] as string[] };
    Object.assign(window, {
      navfix: state,
      coloniaDesktop: {
        platform: "win32",
        setBrowserBounds(b: unknown) {
          state.slot = b;
          state.slots++;
        },
        showBrowserTab: (tab: string) => state.shown.push(tab),
        importSources: async () => [{ id: "src-1", navegador: "chrome", perfil: "alexander" }],
        bookmarkBar: async () => bar,
      },
    });
  }, bookmarks);
}
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { navfix: { slot: Slot; slots: number; shown: string[] } }).navfix);

async function start(page: Page, bookmarks = 6) {
  await rpc("setup.finish", {});
  await rpc("navegadores.set", { id: ID, navegador: { browser: "chrome", name: "alexander" } });
  await desktop(page, bookmarks);
  await page.goto(`/#navegador=${ID}`);
  await expect(page.locator(".navegador")).toBeVisible();
}
const strip = (page: Page) => page.locator(".navegador__tabs").getByRole("tab");
const plus = (page: Page) => page.locator(".navegador__tabs").getByRole("button", { name: "Nueva pestaña" });
const address = (page: Page) => page.getByRole("textbox", { name: "Dirección" });

test.afterEach(async () => {
  await rpc("navegadores.set", { id: ID, navegador: null });
});

test("escribir algo que no es una dirección lo busca, y una dirección la abre", async ({ page }) => {
  const node = await browserNode();
  try {
    await start(page);
    await plus(page).click();
    await address(page).fill("test");
    await address(page).press("Enter");
    await until(async () => node.calls("browser.open").length === 1);
    expect(node.calls("browser.open")[0]).toMatchObject({
      url: "https://www.google.com/search?q=test",
      profile: PROFILE,
    });
    await expect(strip(page)).toHaveCount(1);
    await expect(strip(page)).toHaveText(["www.google.com"]);

    await plus(page).click();
    await address(page).fill("cómo hacer pan");
    await address(page).press("Enter");
    await until(async () => node.calls("browser.open").length === 2);
    expect(node.calls("browser.open")[1]?.url).toBe("https://www.google.com/search?q=c%C3%B3mo%20hacer%20pan");

    await plus(page).click();
    await address(page).fill("example.com/ruta");
    await address(page).press("Enter");
    await until(async () => node.calls("browser.open").length === 3);
    expect(node.calls("browser.open")[2]?.url).toBe("https://example.com/ruta");
    await expect(strip(page)).toHaveCount(3);
  } finally {
    await node.close();
  }
});

test("«+» abre todas las pestañas nuevas que se quiera, vacías o no, y cada una se cierra por separado", async ({
  page,
}) => {
  const node = await browserNode();
  try {
    await start(page);
    for (let i = 1; i <= 4; i++) {
      await plus(page).click();
      await expect(strip(page)).toHaveCount(i);
      await expect(strip(page).nth(i - 1)).toHaveAttribute("aria-selected", "true");
      await expect(address(page)).toBeFocused();
    }
    await expect(strip(page)).toHaveText(Array(4).fill("Nueva pestaña"));
    // Nada de esto ha abierto una página todavía.
    expect(node.calls("browser.open")).toEqual([]);

    // Cerrar la segunda deja las otras tres; cerrar la que está a la vista pasa a su vecina.
    await strip(page).nth(1).getByRole("button", { name: "Cerrar pestaña" }).click();
    await expect(strip(page)).toHaveCount(3);
    await expect(strip(page).nth(2)).toHaveAttribute("aria-selected", "true");
    await strip(page).nth(2).getByRole("button", { name: "Cerrar pestaña" }).click();
    await expect(strip(page)).toHaveCount(2);
    await expect(strip(page).nth(1)).toHaveAttribute("aria-selected", "true");

    // Abrir desde una vacía la convierte en esa página; la otra vacía sigue ahí, y «+» sigue abriendo más.
    await address(page).fill("example.com");
    await address(page).press("Enter");
    await expect(strip(page)).toHaveText(["example.com", "Nueva pestaña"]);
    await expect(strip(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await plus(page).click();
    await plus(page).click();
    await expect(strip(page)).toHaveCount(4);
    await expect(strip(page).nth(3)).toHaveAttribute("aria-selected", "true");

    // Escape en una vacía la cierra.
    await address(page).press("Escape");
    await expect(strip(page)).toHaveCount(3);
    expect(node.calls("browser.open")).toHaveLength(1);
    expect(node.calls("browser.close")).toEqual([]);
  } finally {
    await node.close();
  }
});

test("un marcador abre su página en una pestaña nueva, y la vista pasa a ella sin esperar a que cargue", async ({
  page,
}) => {
  // La página tarda 4 s en cargar: la pestaña tiene que estar a la vista, con su dirección, mucho antes.
  const node = await browserNode(4_000);
  try {
    await start(page);
    const began = Date.now();
    await page.getByRole("button", { name: "Correo 0" }).click();
    await expect(strip(page)).toHaveText(["marcador0.example.com"]);
    await expect(strip(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".btoolbar__urltext")).toHaveText("marcador0.example.com");
    await expect(page.locator(".browser__page--native")).toBeVisible();
    await until(async () => (await state(page)).shown.includes("t1"));
    const s = await state(page);
    expect(s.slot && s.slot.width > 0 && s.slot.height > 0).toBe(true);
    expect(Date.now() - began).toBeLessThan(3_000);
    expect(node.calls("browser.open")).toEqual([
      { url: "https://marcador0.example.com/", by: "operator", profile: PROFILE },
    ]);

    // Con una pestaña a la vista, otro marcador navega en ella; desde una pestaña nueva, abre otra.
    await page.getByRole("button", { name: "Calendario de reuniones 1" }).click();
    await until(async () => node.calls("browser.navigate").length === 1);
    expect(node.calls("browser.navigate")[0]).toMatchObject({ tab: "t1", url: "https://marcador1.example.com/" });
    await plus(page).click();
    await page.getByRole("button", { name: "Correo 0" }).click();
    await expect(strip(page)).toHaveText(["marcador1.example.com", "marcador0.example.com"]);
    await expect(strip(page).nth(1)).toHaveAttribute("aria-selected", "true");
    expect(node.calls("browser.open")).toHaveLength(2);
    await until(node.idle);
  } finally {
    await node.close();
  }
});

test("en el navegador del panel lateral «+» también abre las que se quiera y lo que no es dirección se busca", async ({
  page,
}) => {
  const node = await browserNode();
  try {
    await rpc("setup.finish", {});
    await desktop(page, 0);
    await page.goto("/#panel=browser");
    const tabs = page.locator(".sidepanel").getByRole("tab");
    const more = page.locator(".sidepanel").getByRole("button", { name: "Nueva pestaña" });
    for (let i = 1; i <= 3; i++) {
      await more.click();
      await expect(tabs).toHaveCount(i);
      await expect(tabs.nth(i - 1)).toHaveAttribute("aria-selected", "true");
    }
    await address(page).fill("test");
    await address(page).press("Enter");
    await until(async () => node.calls("browser.open").length === 1);
    expect(node.calls("browser.open")[0]?.url).toBe("https://www.google.com/search?q=test");
    await expect(tabs).toHaveText(["www.google.com", "Nueva pestaña", "Nueva pestaña"]);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".browser__page--native")).toBeVisible();
    const m = await page.evaluate(() => {
      const r = document.querySelector(".browser__page--native")?.getBoundingClientRect();
      return { right: Math.round(r?.right ?? 0), width: Math.round(r?.width ?? 0), viewport: window.innerWidth };
    });
    expect(m.right).toBeLessThanOrEqual(m.viewport);
    expect(m.width).toBeGreaterThan(200);
    // Cerrar una vacía deja la otra; con una vacía abierta, «+» sigue abriendo.
    await tabs.nth(1).getByRole("button", { name: "Cerrar pestaña" }).click();
    await expect(tabs).toHaveCount(2);
    await more.click();
    await more.click();
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
    await address(page).press("Escape");
    await expect(tabs).toHaveCount(3);
    expect(node.calls("browser.close")).toEqual([]);
  } finally {
    await node.close();
  }
});

/** Lo que se mide de la columna del navegador: nada sale de la ventana y la página nativa va justo en su hueco. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : undefined;
    };
    const row = document.querySelector(".bmbar__row") as HTMLElement;
    const items = [...row.children].map((c) => c.getBoundingClientRect());
    const hole = document.querySelector(".browser__page--native")?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      webapp: box(".webapp"),
      bar: box(".bmbar"),
      rows: new Set(items.map((r) => Math.round(r.top))).size,
      itemsRight: Math.round(Math.max(...items.map((r) => r.right))),
      rowRight: Math.round(row.getBoundingClientRect().right),
      shownItems: row.querySelectorAll(".bmbar__item:not(.bmbar__more)").length,
      more: Boolean(row.querySelector(".bmbar__more")),
      hole: hole && {
        x: Math.round(hole.x),
        y: Math.round(hole.y),
        width: Math.round(hole.width),
        height: Math.round(hole.height),
      },
      slot: (window as unknown as { navfix: { slot: Slot } }).navfix.slot,
    };
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`con muchos marcadores la columna no sale de la ventana y la página sigue a su hueco (${scheme})`, async ({
    page,
  }, info) => {
    const node = await browserNode();
    try {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 800 });
      await start(page, 40);
      await page.getByRole("button", { name: "Correo 0" }).click();
      await expect(page.locator(".browser__page--native")).toBeVisible();
      const shown: Record<number, number> = {};
      // Redimensionando la misma ventana, no cargando a cada ancho: la página nativa tiene que seguir al hueco.
      for (const width of [1440, 1200, 960, 768, 640, 1100, 1920]) {
        await page.setViewportSize({ width, height: 800 });
        const at = `a ${width}px`;
        // La barra recuenta cuántos caben y el panel informa del hueco un instante después del cambio de tamaño.
        await expect
          .poll(async () => {
            const now = await measure(page);
            return now.viewport === width && now.slot?.width === now.hole?.width && now.itemsRight <= now.rowRight;
          }, `la barra y la página se asientan ${at}`)
          .toBe(true);
        const m = await measure(page);
        expect(m.scroll, `scroll horizontal ${at}`).toBeLessThanOrEqual(width);
        expect(m.webapp?.right, `la columna ${at}`).toBeLessThanOrEqual(width);
        expect(m.bar?.right, `la barra de marcadores ${at}`).toBeLessThanOrEqual(width);
        expect(m.rows, `filas de marcadores ${at}`).toBe(1);
        expect(m.itemsRight, `el último marcador ${at}`).toBeLessThanOrEqual(m.rowRight);
        expect(m.more, `«más marcadores» ${at}`).toBe(true);
        expect(m.shownItems, `marcadores a la vista ${at}`).toBeGreaterThan(0);
        expect(m.shownItems, `marcadores a la vista ${at}`).toBeLessThan(40);
        // La página nativa: exactamente su hueco, y dentro de la ventana.
        expect(m.slot, `la página ${at}`).toEqual(m.hole);
        expect((m.slot?.x ?? 0) + (m.slot?.width ?? 0), `borde derecho de la página ${at}`).toBeLessThanOrEqual(width);
        expect(m.slot?.width, `ancho de la página ${at}`).toBeGreaterThan(200);
        shown[width] = m.shownItems;
        if (width === 1440 || width === 960)
          await page.screenshot({ path: info.outputPath(`navegador-${scheme}-${width}.png`) });
      }
      // Más ancho, más marcadores a la vista; y al volver a un ancho, los mismos.
      expect(shown[640]).toBeLessThan(shown[960] ?? 0);
      expect(shown[960]).toBeLessThan(shown[1440] ?? 0);
      expect(shown[1440]).toBeLessThan(shown[1920] ?? 0);

      // Lo que no cabe está en «»», y desde ahí también abre.
      await page.setViewportSize({ width: 960, height: 800 });
      await page.getByRole("button", { name: "Más marcadores" }).click();
      await expect(page.getByRole("menuitem").first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`navegador-${scheme}-960-menu.png`) });
      await page.getByRole("menuitem", { name: "Facturas 39" }).click();
      await until(async () => node.calls("browser.navigate").length === 1);
      expect(node.calls("browser.navigate")[0]?.url).toBe("https://marcador39.example.com/");
    } finally {
      await node.close();
    }
  });
}
