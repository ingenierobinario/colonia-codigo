import { hostingGeometry } from "./hosting-geometry.ts";
import { expect, rpc, test } from "./kit.ts";

for (const language of ["es", "en"] as const)
  for (const mode of ["light", "dark"] as const) {
    test(`el escritorio pide elegir de nuevo una carpeta cuya autorización caducó · ${language} · ${mode}`, async ({
      page,
    }) => {
      test.slow();
      await rpc("setup.finish");
      const name = `Compartir materiales revisados ${language} ${mode}`;
      const { project } = await rpc<{ project: { id: string } }>("projects.create", { name });
      const missing = { id: `${project.id}-missing`, name: `${name} (USB)` };
      await page.route("**/rpc/projects.list", async (route) => {
        const response = await route.fetch();
        const reply = await response.json();
        const row = reply.result.projects.find((p: { id: string }) => p.id === project.id);
        expect(row).toBeTruthy();
        row.present = false; // El explorador aún no ha vuelto a indexar esta carpeta.
        reply.result.projects.push({ ...row, ...missing, present: true });
        await route.fulfill({ response, json: reply });
      });
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.prefs", JSON.stringify({ language, mode, sidebarCollapsed: true }));
          Object.assign(window, { coloniaDesktop: { coreLocal: true, openExternal: () => {} } });
        },
        { language, mode },
      );
      await page.emulateMedia({ colorScheme: mode });
      const idle = {
        paired: true,
        reachable: true,
        connected: true,
        can_copy_projects: true,
        role: "secundario",
        mismatch: false,
        pending: 0,
        saved: 0,
        folders: [missing],
        folder_sync: { supported: true, projects: [] },
      };
      const calls: unknown[] = [];
      await page.route("**/rpc/sync.status", (r) =>
        r.fulfill({
          json: {
            ok: true,
            result: {
              ...idle,
              project_files: { projects: 1, completed: 0, files: 0, bytes: 0, state: "failed", why: "selection" },
            },
          },
        }),
      );
      await page.route("**/rpc/sync.copy_projects", (r) => {
        calls.push(r.request().postDataJSON());
        return r.fulfill({
          json: {
            ok: true,
            result: { ...idle, project_files: { projects: 1, completed: 1, files: 1, bytes: 7, state: "done" } },
          },
        });
      });
      const ready = page.waitForResponse((r) => r.url().endsWith("/rpc/sync.status")).then((r) => r.finished());
      await Promise.all([page.goto("/#view=equipos"), ready]);
      const card = page.getByRole("region", { name: /Colonia en un servidor|Colonia on a server/ });
      const choose = card.getByRole("button", { name: /Volver a elegir carpetas|Choose folders again/ });
      await expect(choose).toBeVisible();
      await expect(card.getByRole("button", { name: /Volver a intentar|Try again/ })).toHaveCount(0);
      await choose.click();
      const list = card.locator("fieldset.eq-hosting-folders");
      const folder = list.getByRole("checkbox", { name, exact: true });
      await expect(folder).toBeEnabled();
      await expect(list.getByRole("checkbox", { name: missing.name, exact: true })).toHaveCount(0);
      const sync = card.getByRole("group", { name: /Carpetas sincronizadas|Synced folders/ });
      await sync.locator("summary").click();
      await expect(sync.getByRole("checkbox", { name, exact: true })).toBeEnabled();
      await expect(sync.getByRole("checkbox", { name: missing.name, exact: true })).toBeDisabled();
      await sync.locator("summary").click();
      await expect(folder).not.toBeChecked();
      const send = card.getByRole("button", { name: /Enviar las carpetas seleccionadas|Send selected folders/ });
      await expect(send).toBeDisabled();
      await hostingGeometry(card);
      expect(calls).toEqual([]);
      await folder.check();
      await send.click();
      await expect(card.getByRole("status")).toContainText(/confirmado|confirmed/);
      expect(calls).toEqual([{ projects: [project.id] }]);
    });
  }
