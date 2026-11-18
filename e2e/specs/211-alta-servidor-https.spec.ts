import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./kit.ts";

const origin = "https://colonia-alta.example.test";
const owner = "clave-ficticia-del-propietario";
const device = "credencial-ficticia-del-navegador";
const code = "ABCD-2345";
const panel = new URL("../../apps/web/dist/", import.meta.url);
const welcome = "Conecta este servidor con tu escritorio";

async function geometry(dialog: Locator) {
  const page = dialog.page();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 768, 960, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(
          () =>
            dialog.evaluate((element) => {
              const panel = element.getBoundingClientRect();
              const actions = Array.from(element.querySelectorAll("button, code"), (control) => ({
                box: control.getBoundingClientRect(),
                content: control.scrollWidth,
                available: control.clientWidth,
              }));
              return (
                document.documentElement.scrollWidth <= innerWidth + 1 &&
                panel.left >= -1 &&
                panel.right <= innerWidth + 1 &&
                actions.every(
                  ({ box, content, available }, i) =>
                    box.width > 0 &&
                    content <= available + 1 &&
                    box.left >= panel.left - 1 &&
                    box.right <= panel.right + 1 &&
                    actions
                      .slice(i + 1)
                      .every(
                        ({ box: other }) =>
                          Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 1 ||
                          Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 1,
                      ),
                )
              );
            }),
          { message: `Alta alojada sin desbordes ni botones superpuestos a ${width} en ${colorScheme}` },
        )
        .toBe(true);
    }
  }
}

async function server(page: Page, baseURL: string | undefined, returning = false) {
  if (!baseURL) throw new Error("Falta el núcleo temporal de Playwright.");
  const starts: unknown[] = [];
  const urls: string[] = [];
  const finishes: boolean[] = [];
  const idle = { paired: false, connected: false, reachable: true, pending: 0, saved: 0, mismatch: false };
  page.on("request", (request) => urls.push(request.url()));
  page.on("websocket", (socket) => urls.push(socket.url()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));
  await page.addInitScript(
    ({ returning, device }) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language: returning ? "en" : "es" }));
      if (returning) localStorage.setItem("colonia.token", device);
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            sessionStorage.setItem("copia-sintetica", text);
          },
        },
      });
    },
    { returning, device },
  );
  await page.routeWebSocket("wss://colonia-alta.example.test/ws", (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.t === "hello") socket.send(JSON.stringify({ t: "welcome", session: "sesion-de-prueba" }));
    });
  });
  await page.route(`${origin}/**`, async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    if (url.pathname === "/" || /^\/assets\/[\w-][\w.-]*$/.test(url.pathname)) {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      return r.fulfill({ path: fileURLToPath(new URL(file, panel)) });
    }
    const ok = (result: unknown) => r.fulfill({ json: { ok: true, result } });
    const error = (code: string, message: string) => r.fulfill({ json: { ok: false, error: { code, message } } });
    switch (url.pathname) {
      case "/rpc/system.ping":
        return request.headers().authorization === `Bearer ${device}`
          ? ok({ pong: "pong" })
          : error("unauthorized", "Dispositivo ficticio sin vincular");
      case "/rpc/devices.pair_start":
        expect(request.headers().authorization).toBe(`Bearer ${owner}`);
        return ok({ code: "CDEF3456", urls: [], expires_at: new Date(Date.now() + 60000).toISOString() });
      case "/rpc/devices.pair":
        expect(request.postDataJSON()).toMatchObject({ code: "CDEF3456", platform: "other" });
        return ok({ token: device });
      case "/rpc/equipos.discover":
        return ok({ equipos: [], tailscale: false });
      case "/rpc/setup.status":
        return ok({ fresh: true, done: finishes.includes(true), v1: null, home: "/colonia-de-prueba" });
      case "/rpc/sync.status":
        return ok(returning ? { ...idle, paired: true, role: "principal", connected: true } : idle);
      case "/rpc/sync.pair_start":
        starts.push(request.postDataJSON());
        return ok({
          ...idle,
          pairing: { code, initial_source: "joining_device", expires_at: new Date(Date.now() + 600000).toISOString() },
        });
      case "/rpc/setup.finish":
        finishes.push(finishes.length > 0);
        return finishes.at(-1) ? ok({ done: true }) : error("internal", "Respuesta de prueba al guardar");
      default: {
        // Las peticiones restantes se resuelven dentro del núcleo temporal de Playwright.
        const local = new URL(url.pathname + url.search, baseURL);
        const headers: Record<string, string> = { ...request.headers(), origin: new URL(baseURL).origin };
        delete headers.authorization;
        const response = await r.fetch({ url: local.href, headers });
        return r.fulfill({ response });
      }
    }
  });
  return { starts, urls, finishes };
}

test("el propietario genera una invitación HTTPS por elección y puede configurar una Colonia nueva", async ({
  page,
  baseURL,
}) => {
  const state = await server(page, baseURL);
  await page.goto(origin);
  await page.getByRole("button", { name: "Este servidor es mío" }).click();
  const form = page.locator("form.pair");
  await form.getByLabel("Clave del servidor").fill(owner);
  await form.locator("[type=submit]").click();
  const dialog = page.getByRole("dialog", { name: welcome });
  const generate = dialog.getByRole("button", { name: "Generar invitación para el PC" });
  await expect(generate).toBeVisible();
  await expect(page).toHaveURL(`${origin}/#view=equipos&host=welcome`);
  expect(state.starts).toEqual([]);
  await generate.click();
  await expect(dialog.locator("code")).toHaveText(`${origin} ${code}`);
  await geometry(dialog);
  await dialog.getByRole("button", { name: "Copiar invitación" }).click();
  await expect(dialog.getByRole("button", { name: "Invitación copiada" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("copia-sintetica"))).toBe(`${origin} ${code}`);
  expect(state.starts).toEqual([{ initial_source: "joining_device" }]);
  await dialog.getByRole("button", { name: "Configurar como Colonia nueva" }).click();
  await expect(page.locator(".wiz")).toBeVisible();
  await expect(page).toHaveURL(`${origin}/#view=equipos`);
  expect(state.finishes).toEqual([]);
  for (const url of state.urls)
    for (const secret of [owner, device, "CDEF3456", code]) expect(url).not.toContain(secret);
});

test("el propietario vinculado puede volver a guardar un alta que el servidor rechazó", async ({ page, baseURL }) => {
  const state = await server(page, baseURL, true);
  await page.goto(`${origin}/#view=equipos&host=welcome`);
  const dialog = page.getByRole("dialog", { name: "Connect this server to your desktop" });
  const open = dialog.getByRole("button", { name: "Open my Colonia" });
  await expect(open).toBeVisible();
  await geometry(dialog);
  await open.click();
  await expect(page.getByText(/Respuesta de prueba al guardar/)).toBeVisible();
  await expect(open).toBeVisible();
  await expect(page).toHaveURL(`${origin}/#view=equipos&host=welcome`);
  await page.reload();
  await expect(open).toBeVisible();
  await open.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/#view=equipos`);
  expect(state.starts).toEqual([]);
  expect(state.finishes).toEqual([false, true]);
});
