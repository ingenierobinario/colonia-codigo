import type { Locator, Page } from "@playwright/test";
import { expect, rpc, test } from "./kit.ts";

function teamScreenLoaded(page: Page) {
  return page.waitForResponse(/\/assets\/EquiposScreen-[\w-]+\.js$/).then((response) => response.finished());
}

test("Mis equipos empieza a descargar su traducción mientras llega la pantalla", async ({ page }) => {
  await rpc("setup.finish");
  await page.addInitScript(() => localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" })));
  let resume = () => {};
  const hold = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route(/\/assets\/EquiposScreen-[\w-]+\.js$/, async (route) => {
    await hold;
    await route.continue();
  });
  await page.route("**/rpc/equipos.discover", (route) =>
    route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
  );
  const screenLoaded = teamScreenLoaded(page);
  const translation = page.waitForRequest(/\/assets\/equipos-es-[\w-]+\.js$/, { timeout: 10_000 });
  try {
    await Promise.all([page.goto("/#view=equipos", { waitUntil: "domcontentloaded" }), translation]);
  } finally {
    resume();
    await screenLoaded;
  }
  await expect(page.getByRole("region", { name: "Colonia en un servidor" })).toBeVisible();
});

async function fits(group: Locator) {
  const controls = group.locator("button, input");
  for (const width of [390, 768, 960, 1200, 1440]) {
    await group.page().setViewportSize({ width, height: 900 });
    await expect
      .poll(
        () =>
          controls.evaluateAll((elements) => {
            const boxes = elements.map((e) => e.getBoundingClientRect());
            return (
              document.documentElement.scrollWidth <= innerWidth + 1 &&
              elements.every((el, i) => {
                const box = el.getBoundingClientRect();
                return (
                  box.width > 0 &&
                  box.left >= 0 &&
                  box.right <= innerWidth + 1 &&
                  el.scrollWidth <= el.clientWidth + 1 &&
                  el.scrollHeight <= el.clientHeight + 1 &&
                  boxes.every(
                    (b, j) =>
                      i === j ||
                      Math.min(b.right, box.right) - Math.max(b.left, box.left) <= 1 ||
                      Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top) <= 1,
                  )
                );
              })
            );
          }),
        { message: `Controles sin cortes ni solapes a ${width} px` },
      )
      .toBe(true);
  }
}

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`crear un servidor desde Mis equipos · ${language} · ${mode}`, async ({ page }) => {
      await rpc("setup.finish");
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript((lang) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language: lang, sidebarCollapsed: true }));
        Object.assign(window, {
          coloniaDesktop: { coreLocal: true, openExternal: (url: string) => sessionStorage.setItem("enlace", url) },
        });
      }, language);
      await page.route("**/rpc/equipos.discover", (route) =>
        route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
      );
      await Promise.all([
        teamScreenLoaded(page),
        page
          .waitForResponse(new RegExp(`/assets/equipos-${language}-[\\w-]+\\.js$`))
          .then((response) => response.finished()),
        page.goto("/#view=equipos", { waitUntil: "domcontentloaded" }),
      ]);
      const card = page.getByRole("region", {
        name: language === "es" ? "Colonia en un servidor" : "Colonia on a server",
      });
      await expect(card).toBeVisible();
      await fits(card);
      const deploy = card.getByRole("button", { name: /Railway/ });
      if (process.env.VITE_COLONIA_RAILWAY_TEMPLATE) {
        await deploy.click();
        const link = new URL(await page.evaluate(() => sessionStorage.getItem("enlace") ?? ""));
        expect(link.origin).toBe("https://railway.com");
        expect(link.pathname).toBe(`/new/template/${process.env.VITE_COLONIA_RAILWAY_TEMPLATE}`);
        expect(link.searchParams.get("referralCode")).toBe(process.env.VITE_COLONIA_RAILWAY_REFERRAL || "dBUtql");
        await expect(card).toContainText(/comisión|commission/);
        await expect(card).not.toContainText(/Railway cobra|Railway charges|coste|cost depends/i);
      } else await expect(deploy).toHaveCount(0);
      await card.getByRole("button", { name: /propio servidor|my own server/ }).click();
      expect(await page.evaluate(() => sessionStorage.getItem("enlace"))).toBe(
        `https://colonia.ingenierobinario.com/${language === "es" ? "es/" : ""}docs/devices/server/`,
      );
    });

    test(`primera vinculación desde la cuenta del servidor · ${language} · ${mode}`, async ({ page }) => {
      const ownerKey = "clave-sintetica-del-servidor";
      const deviceKey = "clave-distinta-del-dispositivo";
      const denied = { ok: false, error: { code: "unauthorized", message: "unauthorized" } };
      const called: string[] = [];
      const exposed: string[] = [];
      page.on("request", (req) => {
        if (req.url().includes(ownerKey) || req.postData()?.includes(ownerKey)) exposed.push(req.method());
      });
      page.on("websocket", (ws) => {
        if (ws.url().includes(ownerKey) || ws.url().includes(deviceKey)) exposed.push("ws");
      });
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript(
        (lang) => localStorage.setItem("colonia.prefs", JSON.stringify({ language: lang })),
        language,
      );
      await page.route("**/rpc/system.ping", async (route) => {
        if (route.request().headers().authorization === `Bearer ${deviceKey}`) await route.continue();
        else await route.fulfill({ json: denied });
      });
      await page.route("**/rpc/devices.pair_start", (route) => {
        const valid = route.request().headers().authorization === `Bearer ${ownerKey}`;
        called.push(valid ? "aceptada" : "rechazada");
        return route.fulfill({
          json: valid
            ? {
                ok: true,
                result: { code: "ABCD2345", urls: [], expires_at: new Date(Date.now() + 60_000).toISOString() },
              }
            : denied,
        });
      });
      await page.route("**/rpc/devices.pair", (route) => {
        expect(route.request().headers().authorization).toBeUndefined();
        expect(route.request().postDataJSON()).toMatchObject({ code: "ABCD2345", platform: "other" });
        called.push("vinculada");
        return route.fulfill({ json: { ok: true, result: { token: deviceKey } } });
      });
      await page.goto("/");
      await page.getByRole("button", { name: /Este servidor es mío|I own this server/ }).click();
      const form = page.locator("form.pair");
      const key = form.getByLabel(/Clave del servidor|Server key/);
      await expect(key).toHaveAttribute("type", "password");
      await fits(form);
      await key.fill("incorrecta");
      await form.locator("[type=submit]").click();
      await expect(form.getByRole("alert")).toBeVisible();
      await expect(key).toHaveValue("");
      await key.fill(ownerKey);
      const live = page
        .waitForEvent("websocket", (ws) => new URL(ws.url()).pathname === "/ws")
        .then(async (ws) => {
          await ws.waitForEvent("framereceived", (frame) => JSON.parse(String(frame.payload)).t === "welcome");
          return new URL(ws.url()).search;
        });
      await Promise.all([
        page.waitForRequest(
          (req) => req.url().endsWith("/rpc/system.ping") && req.headers().authorization === `Bearer ${deviceKey}`,
        ),
        form.locator("[type=submit]").click(),
      ]);
      expect(await live).toBe("");
      expect(await page.evaluate(() => localStorage.getItem("colonia.token"))).toBe(deviceKey);
      expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(ownerKey);
      expect(called).toEqual(["rechazada", "aceptada", "vinculada"]);
      expect(exposed).toEqual([]);
    });
  }
}
