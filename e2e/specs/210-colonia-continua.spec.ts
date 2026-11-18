import type { Locator } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

async function geometry(root: Locator) {
  for (const width of [390, 768, 960, 1200, 1440]) {
    await root.page().setViewportSize({ width, height: 900 });
    await expect
      .poll(
        () =>
          root.evaluate((el) => {
            const elements = Array.from(el.querySelectorAll("button, input, legend, code")).filter(
              (e) => e.getBoundingClientRect().width,
            );
            const buttons = elements.filter((e) => e.tagName === "BUTTON").map((e) => e.getBoundingClientRect());
            return (
              document.documentElement.scrollWidth <= innerWidth + 1 &&
              elements.every((e) => {
                const box = e.getBoundingClientRect();
                return (
                  box.left >= -1 &&
                  box.right <= innerWidth + 1 &&
                  (e.tagName !== "BUTTON" ||
                    (e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1))
                );
              }) &&
              buttons.every((a, i) =>
                buttons
                  .slice(i + 1)
                  .every(
                    (b) =>
                      Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 ||
                      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1,
                  ),
              )
            );
          }),
        { message: `Controles utilizables a ${width} px` },
      )
      .toBe(true);
  }
}

test("la pestaña de rutinas empieza a cargar aunque el código de la vista del proyecto siga en tránsito", async ({
  page,
}) => {
  await rpc("setup.finish");
  test.slow();
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Rutinas en paralelo" });
  let resume = () => {};
  const hold = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route(/\/assets\/ProjectScreen-[\w-]+\.js$/, async (route) => {
    await hold;
    await route.continue();
  });
  const projectView = page
    .waitForResponse(/\/assets\/ProjectScreen-[\w-]+\.js$/)
    .then((response) => response.finished());
  const routines = page.waitForRequest(/\/assets\/RoutinesPane-[\w-]+\.js$/, { timeout: 20_000 });
  try {
    await Promise.all([page.goto(`/#project=${project.id}&tab=routines`, { waitUntil: "domcontentloaded" }), routines]);
  } finally {
    resume();
    await projectView;
  }
  await expect(page.getByRole("button", { name: /Nueva rutina|New routine/ })).toBeVisible();
});

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`el escritorio ofrece continuidad al activar una rutina y sincroniza por elección · ${language} · ${mode}`, async ({
      page,
    }) => {
      // El recorrido guarda una rutina y comprueba dos formularios a cinco anchos.
      test.slow();
      await rpc("setup.finish");
      const name = `Continuidad ${language} ${mode}`;
      const { project } = await rpc<{ project: { id: string } }>("projects.create", { name });
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.prefs", JSON.stringify({ language, mode, sidebarCollapsed: true }));
          Object.assign(window, { coloniaDesktop: { coreLocal: true, openExternal: () => {} } });
        },
        { language, mode },
      );
      const sent: unknown[] = [];
      const copies: unknown[] = [];
      const idle = { paired: false, reachable: false, connected: false, mismatch: false, pending: 0, saved: 0 };
      const paired = {
        ...idle,
        paired: true,
        role: "secundario",
        connected: true,
        can_copy_projects: true,
        peer: { name: "Servidor 24h" },
      };
      await page.route("**/rpc/sync.status", (r) =>
        r.fulfill({ json: { ok: true, result: sent.length ? paired : idle } }),
      );
      await page.route("**/rpc/sync.pair_join", (r) => {
        sent.push(r.request().postDataJSON());
        return r.fulfill({ json: { ok: true, result: paired } });
      });
      await page.route("**/rpc/sync.copy_projects", (r) => {
        copies.push(r.request().postDataJSON());
        return r.fulfill({
          json: {
            ok: true,
            result: { ...paired, project_files: { state: "done", projects: 1, completed: 1, files: 1, bytes: 10 } },
          },
        });
      });
      const loaded = page.waitForResponse(/\/assets\/RoutinesPane-[\w-]+\.js$/).then((response) => response.finished());
      const directory = page
        .waitForResponse((response) => response.url().endsWith("/rpc/projects.list"))
        .then((response) => response.finished());
      await Promise.all([open(page, `#project=${project.id}&tab=routines`), loaded, directory]);
      const offer = page.getByRole("dialog", { name: /Colonia siga trabajando|Keep Colonia working/ });
      const add = page.getByRole("button", { name: /Nueva rutina|New routine/ });
      await expect(add).toBeVisible();
      await expect(offer).toHaveCount(0);
      await add.click();
      const editor = page.getByRole("dialog");
      await editor.getByRole("textbox", { name: /^Nombre$|^Name$/ }).fill(name);
      await editor.getByRole("textbox", { name: /Qué hacer|What to do/i }).fill("Revisar el programa de prueba.");
      await editor.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
      await expect(offer).toBeVisible();
      await geometry(offer);
      await offer.getByRole("button", { name: /Ver opciones de servidor|View server options/ }).click();
      const card = page.getByRole("region", { name: /Colonia en un servidor|Colonia on a server/ });
      await expect(card).toBeFocused();
      await card.getByRole("button", { name: /Ya tengo servidor|I have a server/ }).click();
      const invitation = card.getByRole("textbox", { name: /Invitación del servidor|Server invitation/ });
      const submit = card.getByRole("button", { name: /Sincronizar con este servidor|Sync with this server/ });
      await invitation.fill("https://prueba.example?secret=x ABCD-2345");
      await expect(submit).toBeDisabled();
      await invitation.fill("https://servidor-prueba.example ABCD-2345");
      await expect(card.getByText("servidor-prueba.example", { exact: true })).toBeVisible();
      await expect(card.getByText(/claves de proveedores|provider keys/)).toBeVisible();
      const folder = card.getByRole("checkbox", { name, exact: true });
      await expect(folder).not.toBeChecked();
      await folder.check();
      await geometry(card);
      expect(sent).toEqual([]);
      await submit.click();
      await expect(card.getByText(/servidor principal|primary server/)).toBeVisible();
      expect(sent).toEqual([{ address: "https://servidor-prueba.example", code: "ABCD-2345", projects: [project.id] }]);
      await card.getByRole("button", { name: /Añadir carpetas al servidor|Add folders to the server/ }).click();
      await expect(folder).not.toBeChecked();
      await card.getByRole("button", { name: /Ahora no|Not now/ }).click();
      expect(copies).toEqual([]);
      await card.getByRole("button", { name: /Añadir carpetas al servidor|Add folders to the server/ }).click();
      await folder.check();
      await card.getByRole("button", { name: /Enviar las carpetas seleccionadas|Send selected folders/ }).click();
      await expect(card.getByRole("status")).toContainText(/confirmado|confirmed/);
      expect(copies).toEqual([{ projects: [project.id] }]);
      await page.reload();
      await expect(offer).toHaveCount(0);
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("ABCD-2345");
    });
  }
}
