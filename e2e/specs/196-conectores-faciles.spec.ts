import { expect, rpc, test } from "./kit.ts";

const longName = "conector-administracion-internacional";
test.beforeAll(async () => {
  await rpc("setup.finish");
});

for (const language of ["es", "en"]) {
  for (const theme of ["light", "dark"] as const) {
    test(`logos y nombres completos de los conectores en ${language}, tema ${theme}`, async ({ page }) => {
      // Respuestas de prueba: no arrancamos servidores de conectores ni tocamos definiciones guardadas.
      await page.route("**/rpc/mcp.list", (route) =>
        route.fulfill({
          json: {
            ok: true,
            result: {
              servers: ["notion", longName].map((name) => ({
                name,
                scope: "global",
                transport: "http",
                target: "https://example.test",
                enabled: true,
                trusted: true,
                status: "off",
                tools: 0,
                tool_names: [],
                vars: [],
                only: false,
                tool_permission_mode: "ask",
              })),
            },
          },
        }),
      );
      await page.addInitScript((language) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language, sidebarCollapsed: true }));
      }, language);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/#view=resources&resourcesTab=mcp");
      await page.getByRole("radio", { name: language === "es" ? /^Conectores/ : /^Connectors/ }).click();
      const row = page.getByRole("button", { name: new RegExp(longName) });
      const named = page.getByRole("button", { name: /^notion/i });
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(named.locator(".colonia-pickrow__lead svg")).toBeVisible();
        await expect(row.locator(".colonia-pickrow__lead")).toHaveText("C");
        const fits = await row.evaluate((el) => {
          const parts = Array.from(el.children).map((child) => child.getBoundingClientRect());
          return (
            parts.every((part, i) => i === 0 || part.left >= (parts[i - 1]?.right ?? 0) - 1) &&
            Array.from(el.querySelectorAll<HTMLElement>(".colonia-pickrow__title,.colonia-pickrow__desc")).every(
              (part) => part.scrollWidth <= part.clientWidth + 1,
            ) &&
            document.documentElement.scrollWidth <= innerWidth + 1
          );
        });
        expect(fits, `ancho ${width}`).toBe(true);
      }
      await page
        .getByRole("button", { name: language === "es" ? "Añadir conector" : "Add connector", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.test/mcp");
      const name = dialog.getByRole("textbox", { name: language === "es" ? "Nombre" : "Name", exact: true });
      await name.fill("notion");
      await expect(
        dialog.getByRole("button", { name: language === "es" ? "Crear" : "Create", exact: true }),
      ).toBeDisabled();
      await name.fill("acme");
      await expect(
        dialog.getByRole("button", { name: language === "es" ? "Crear" : "Create", exact: true }),
      ).toBeEnabled();
    });
  }
}
