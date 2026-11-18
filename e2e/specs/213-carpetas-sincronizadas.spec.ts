import { hostingGeometry } from "./hosting-geometry.ts";
import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const)
  for (const mode of ["light", "dark"] as const) {
    test(`la persona acepta o detiene el intercambio de archivos de un proyecto · ${language} · ${mode}`, async ({
      page,
    }) => {
      test.slow();
      await rpc("setup.finish");
      const name = `Documentación, diseños y entregas del equipo ${language} ${mode}`;
      const { project } = await rpc<{ project: { id: string } }>("projects.create", { name });
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.prefs", JSON.stringify({ language, mode, sidebarCollapsed: true }));
          Object.assign(window, { coloniaDesktop: { coreLocal: true, openExternal: () => {} } });
        },
        { language, mode },
      );
      await page.emulateMedia({ colorScheme: mode });
      let enabled = false;
      let rejectNext = false;
      const changes: unknown[] = [];
      const status = () => ({
        paired: true,
        reachable: true,
        connected: true,
        role: "secundario",
        mismatch: false,
        pending: 0,
        saved: 0,
        peer: { name: "Servidor" },
        folder_sync: {
          supported: true,
          projects: [
            {
              id: project.id,
              local: enabled,
              remote: true,
              state: enabled ? "current" : "waiting",
              conflicts: enabled ? 1 : 0,
            },
          ],
        },
      });
      await page.route("**/rpc/sync.status", (route) => route.fulfill({ json: { ok: true, result: status() } }));
      await page.route("**/rpc/sync.set_folder_sync", (route) => {
        const body = route.request().postDataJSON();
        changes.push(body);
        if (rejectNext) {
          rejectNext = false;
          return route.fulfill({ json: { ok: false, error: { code: "internal", message: "Fallo de prueba" } } });
        }
        enabled = body.enabled;
        return route.fulfill({ json: { ok: true, result: status() } });
      });
      const ready = page.waitForResponse((r) => r.url().endsWith("/rpc/sync.status")).then((r) => r.finished());
      await Promise.all([page.goto("/#view=equipos"), ready]);
      const settings = page.getByRole("group", { name: /Carpetas sincronizadas|Synced folders/ });
      await expect(settings).toBeVisible();
      await settings.locator("summary").click();
      const chosen = settings.getByRole("checkbox", { name, exact: true });
      await expect(chosen).not.toBeChecked();
      await expect(settings.getByText(/otro equipo ha solicitado|other computer has requested/i)).toBeVisible();
      expect(changes).toEqual([]);
      await hostingGeometry(settings);
      rejectNext = true;
      await chosen.click();
      await expect(settings.getByRole("alert")).toBeVisible();
      await expect(chosen).not.toBeChecked();
      await chosen.check();
      await expect(settings.getByText(/ambas versiones|both versions/i).last()).toBeVisible();
      await chosen.uncheck();
      await expect(chosen).toBeEnabled();
      await expect(chosen).not.toBeChecked();
      expect(changes).toEqual([
        { project: project.id, enabled: true },
        { project: project.id, enabled: true },
        { project: project.id, enabled: false },
      ]);
      await page
        .getByRole("region", { name: /Colonia en un servidor|Colonia on a server/ })
        .getByRole("button", { name: /Sincronizar equipos|Sync computers/ })
        .click();
      const advanced = page.getByRole("dialog").getByRole("group", { name: /Carpetas sincronizadas|Synced folders/ });
      await advanced.locator("summary").click();
      await expect(advanced.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
      await hostingGeometry(advanced);
    });
  }
