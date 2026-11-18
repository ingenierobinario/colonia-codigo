import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`Mis equipos abre traslado y sincronización · ${language} · ${mode}`, async ({ page }) => {
      await rpc("setup.finish");
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript((language) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
      }, language);
      await page.route("**/rpc/equipos.discover", (route) =>
        route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
      );
      await page.route("**/rpc/equipos.list", (route) =>
        route.fulfill({
          json: {
            ok: true,
            result: {
              equipos: [
                {
                  id: "eqp_revision",
                  name: "Equipo de trabajo",
                  platform: "windows",
                  created_at: "2026-01-01T00:00:00Z",
                  connected: true,
                  agent_access: true,
                  in_use: false,
                  via: "colonia",
                },
              ],
            },
          },
        }),
      );
      let reads = 0;
      await page.route("**/rpc/equipos.list_files", (route) => {
        expect(route.request().postDataJSON()).toEqual({ equipo: "eqp_revision", path: "." });
        reads++;
        return route.fulfill({ json: { ok: true, result: { output: "informe-del-equipo.txt", truncated: false } } });
      });
      await page.goto("/#view=equipos");
      const group = page.locator(".eq-transfer");
      await expect(group).toBeVisible();
      const inspection = page.locator(".eq-inspect");
      await inspection.locator("summary").click();
      expect(reads).toBe(0);
      await inspection.getByRole("button").click();
      await expect(inspection.getByRole("status")).toContainText("informe-del-equipo.txt");
      expect(reads).toBe(1);
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const fits = await group.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const buttons = [...el.querySelectorAll("button")];
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth + 1 &&
            buttons.length === 2 &&
            buttons.every((b) => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1) &&
            document.documentElement.scrollWidth <= innerWidth
          );
        });
        expect(fits, `geometría a ${width}`).toBe(true);
        const inside = await inspection.evaluate((el) =>
          [...el.querySelectorAll("button, input, pre")].every(
            (child) => child.getBoundingClientRect().right <= innerWidth + 1,
          ),
        );
        expect(inside).toBe(true);
      }
      await group.getByRole("button", { name: language === "es" ? "Sincronizar equipos" : "Sync computers" }).click();
      await expect(page.locator("[data-sy=what]")).toBeVisible();
      await page.keyboard.press("Escape");
      await group.getByRole("button", { name: language === "es" ? "Copia y traslado" : "Backup & transfer" }).click();
      await expect(page.locator("[data-bk=create]")).toBeVisible();
      const settings = page.getByRole("dialog");
      await settings.getByRole("button", { name: language === "es" ? "Cuenta" : "Account", exact: true }).click();
      const cloud = settings.getByRole("button", { name: language === "es" ? "Configurar copia" : "Set up a backup" });
      await expect(cloud).toBeVisible();
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await cloud.scrollIntoViewIfNeeded();
        const fits = await cloud.evaluate((button) => {
          const text = button.closest(".colonia-setting")?.querySelector(".colonia-setting__text");
          if (!text) return false;
          const a = text.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          return (
            text.scrollWidth <= text.clientWidth + 1 &&
            b.right <= innerWidth + 1 &&
            (a.right <= b.left + 1 || a.bottom <= b.top + 1)
          );
        });
        expect(fits, `cuenta a ${width}`).toBe(true);
      }
      await cloud.click();
      await expect(settings.locator("input[name=backup-folder]")).toBeVisible();
    });
  }
}

for (const language of ["es", "en"] as const) {
  test(`una tarea llega al borrador del equipo elegido y espera el envío en ${language}`, async ({ page }) => {
    await rpc("setup.finish");
    await page.addInitScript((language) => {
      localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
    }, language);
    const machines = [
      { id: "eqp_alfa", name: "Equipo internacional de revisión de documentos", connected: true, agent_access: true },
      { id: "eqp_beta", name: "Segundo equipo de diseño", connected: true, agent_access: true },
      { id: "eqp_fuera", name: "Equipo apagado", connected: false, agent_access: true },
      { id: "eqp_cerrado", name: "Equipo restringido", connected: true, agent_access: false },
    ];
    await page.route("**/rpc/equipos.discover", (route) =>
      route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
    );
    await page.route("**/rpc/equipos.list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            equipos: machines.map((m) => ({
              ...m,
              via: "colonia",
              platform: "linux",
              in_use: false,
              created_at: "2026-01-01T00:00:00Z",
            })),
          },
        },
      }),
    );
    const dispatched: string[] = [];
    await page.route(/\/rpc\/(threads\.send|equipos\.run)$/, (route) => {
      dispatched.push(new URL(route.request().url()).pathname);
      return route.abort();
    });
    const action = language === "es" ? "Pedir una tarea" : "Request a task";
    const review = language === "es" ? "Revisar en el chat" : "Review in chat";
    await page.goto("/#view=equipos");
    for (const id of ["eqp_fuera", "eqp_cerrado"]) {
      await expect(page.locator(`[data-equipo-id="${id}"]`).getByRole("button", { name: action })).toBeDisabled();
    }
    const previous: string[] = [];
    for (const [index, m] of machines.slice(0, 2).entries()) {
      const card = page.locator(`[data-equipo-id="${m.id}"]`);
      await card.getByRole("button", { name: action }).click();
      const request = card.locator(".eq-task");
      const task = index === 0 ? "Revisar el resumen mensual" : "Revisar el informe de diseño";
      await request.getByRole("textbox").fill(task);
      if (index === 0) {
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          for (const width of [390, 768, 960, 1200, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const fits = await request.evaluate((box) => {
              const bounds = box.getBoundingClientRect();
              const controls = [...box.querySelectorAll<HTMLElement>("button, textarea, label, p")];
              const rects = controls.map((el) => el.getBoundingClientRect());
              return (
                controls.every((el, i) => {
                  const rect = el.getBoundingClientRect();
                  return (
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1 &&
                    el.scrollWidth <= el.clientWidth + 1 &&
                    rects
                      .slice(i + 1)
                      .every(
                        (b) =>
                          rect.bottom <= b.top + 1 ||
                          b.bottom <= rect.top + 1 ||
                          rect.right <= b.left + 1 ||
                          b.right <= rect.left + 1,
                      )
                  );
                }) && document.documentElement.scrollWidth <= innerWidth + 1
              );
            });
            expect(fits, `${language} ${theme} ${width}`).toBe(true);
          }
        }
      }
      await request.getByRole("button", { name: review }).click();
      const composer = page.locator("textarea.colonia-composer__input").last();
      await expect(composer).toBeVisible();
      await expect(composer).toHaveValue(new RegExp(m.id));
      expect(await composer.inputValue()).toContain(m.name);
      expect(await composer.inputValue()).toContain(task);
      previous.push(page.url());
      await page.goto("/#view=equipos");
    }
    const [first, second] = previous;
    if (!first || !second) throw new Error("Falta el chat de uno de los equipos.");
    expect(first).not.toBe(second);
    await page.goto(first);
    await expect(page.locator("textarea.colonia-composer__input").last()).toHaveValue(/eqp_alfa/);
    expect(dispatched).toEqual([]);
  });
}

test("revocar el permiso mientras se escribe conserva la tarea y evita crear el chat", async ({ page }) => {
  await rpc("setup.finish");
  let allowed = true;
  let creations = 0;
  await page.route("**/rpc/equipos.discover", (route) =>
    route.fulfill({ json: { ok: true, result: { equipos: [], tailscale: false } } }),
  );
  await page.route("**/rpc/equipos.list", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: {
          equipos: [
            {
              id: "eqp_revocado",
              name: "Equipo de pruebas",
              platform: "linux",
              in_use: false,
              via: "colonia",
              created_at: "2026-01-01T00:00:00Z",
              agent_access: allowed,
              connected: true,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/rpc/threads.create", (route) => {
    creations++;
    return route.abort();
  });
  await page.goto("/#view=equipos");
  const card = page.locator('[data-equipo-id="eqp_revocado"]');
  await card.getByRole("button", { name: "Pedir una tarea" }).click();
  await card.getByRole("textbox", { name: /Qué quieres hacer/ }).fill("Revisar un documento");
  allowed = false;
  await card.getByRole("button", { name: "Revisar en el chat" }).click();
  await expect(card.getByRole("button", { name: "Pedir una tarea" })).toBeDisabled();
  expect(creations).toBe(0);
  allowed = true;
  const original = card.getByRole("textbox", { name: /Qué quieres hacer/ });
  await expect(original).toHaveValue("Revisar un documento");
});
