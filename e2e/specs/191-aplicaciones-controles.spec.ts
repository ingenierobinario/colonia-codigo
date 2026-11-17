import { ColoniaClient } from "../../packages/protocol/src/client.ts";
import { expect, rpc, test, world } from "./kit.ts";

for (const language of ["es", "en"]) {
  for (const mode of ["light", "dark"] as const) {
    test(`buscar y gestionar descargas sin recortes: ${language}, ${mode}`, async ({ page }, info) => {
      await rpc("setup.finish");
      await rpc("webapps.set", { id: "acme-controles", app: { name: "Acme", url: "https://example.com" } });
      const { core, token } = await world.info();
      const node = await new ColoniaClient({ url: core, token }).connect("node", ["browser"]);
      const tab = {
        tab: "controles",
        url: "https://example.com",
        title: "Acme",
        profile: "app:acme-controles",
        control: { kind: "idle" },
      };
      node.onRequest(async (method) => {
        if (method === "browser.tabs") return { tabs: [tab] };
        if (method === "browser.open") return tab;
        throw new Error(`Petición inesperada: ${method}`);
      });
      try {
        await page.emulateMedia({ colorScheme: mode });
        await page.addInitScript((language) => {
          localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
          Object.assign(window, {
            coloniaDesktop: {
              platform: "win32",
              setBrowserBounds() {},
              showBrowserTab() {},
              tabAction: (tab: string, action: string) => {
                if (tab === "controles" && action === "find") window.dispatchEvent(new Event("prueba-buscar"));
              },
              onFindOpen: (callback: (tab: string) => void) => {
                window.addEventListener("prueba-buscar", () => callback("controles"));
              },
              onDownload: (
                callback: (notice: { id: string; name: string; state: "completed"; opens: boolean }) => void,
              ) => {
                window.addEventListener("prueba-descarga", () =>
                  callback({
                    id: "informe",
                    name: "Informe_de_operaciones_internacionales_y_resultados_del_equipo_Acme.pdf",
                    state: "completed",
                    opens: true,
                  }),
                );
              },
              findInPage: (tab: string, text: string) => {
                document.documentElement.dataset.find = `${tab}:${text}`;
              },
              stopFind: () => {
                document.documentElement.dataset.find = "cerrado";
              },
              openDownload: (id: string) => {
                document.documentElement.dataset.opened = id;
              },
              showDownload: (id: string) => {
                document.documentElement.dataset.revealed = id;
              },
            },
          });
        }, language);
        await page.goto("/#webapp=acme-controles");
        await expect(page.locator(".webapp .browser__page--native")).toBeVisible();
        await page
          .getByRole("button", { name: language === "es" ? "Buscar en la página" : "Find in page", exact: true })
          .click();
        await page.evaluate(() => {
          window.dispatchEvent(new Event("prueba-descarga"));
        });
        const search = page.getByRole("search");
        await expect(search).toBeVisible();
        const input = search.getByRole("textbox", { name: language === "es" ? "Buscar en la página" : "Find in page" });
        await input.fill("Acme");
        await expect(page.locator("html")).toHaveAttribute("data-find", "controles:Acme");
        const download = page.locator(".bextra[role=status]");
        await expect(download).toContainText(language === "es" ? "Descargado:" : "Downloaded:");
        for (const width of [390, 768, 960, 1200, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const geometry = await download.evaluate((el) => {
            const text = el.querySelector(".bextra__text");
            if (!text) throw new Error("Falta el nombre de la descarga");
            const boxes = [...el.children].map((child) => child.getBoundingClientRect());
            return {
              fits: text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1,
              overlap: boxes.some((a, i) =>
                boxes
                  .slice(i + 1)
                  .some(
                    (b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1,
                  ),
              ),
              page: document.documentElement.scrollWidth,
              viewport: innerWidth,
            };
          });
          expect(geometry.fits).toBe(true);
          expect(geometry.overlap).toBe(false);
          expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
          await page.screenshot({ path: info.outputPath(`controles-${language}-${mode}-${width}.png`) });
        }
        await download.getByRole("button", { name: language === "es" ? "Abrir" : "Open", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-opened", "informe");
        await download
          .getByRole("button", { name: language === "es" ? "Ver en la carpeta" : "Show in folder", exact: true })
          .click();
        await expect(page.locator("html")).toHaveAttribute("data-revealed", "informe");
        await input.press("Escape");
        await expect(search).toHaveCount(0);
        await expect(page.locator("html")).toHaveAttribute("data-find", "cerrado");
        await download.getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true }).click();
        await expect(download).toHaveCount(0);
      } finally {
        await page.close();
        node.close();
        await node.closed;
        await rpc("webapps.set", { id: "acme-controles", app: null });
      }
    });
  }
}
