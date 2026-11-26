import { expect, rpc, test } from "./kit.ts";

for (const engine of [
  { id: "claude", plan: "Claude" },
  { id: "codex", plan: "ChatGPT" },
]) {
  test(`los chats de ${engine.id} permiten abrir las cuentas para los agentes`, async ({ page }) => {
    await rpc("setup.finish");
    await page.route("**/rpc/engines.status", (route) =>
      route.fulfill({ json: { ok: true, result: { engines: [] } } }),
    );
    await page.goto(`/#engine=${engine.id}`);
    await expect(page.getByRole("button", { name: "Configurar estas apps", exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: `Usar ${engine.plan} con mis agentes` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Con tu cuenta", { exact: true })).toBeVisible();
  });
}

for (const copy of [
  {
    language: "es",
    settings: "Configurar estas apps",
    heading: "Chats con otras apps",
    session: "Cada app gestiona sus propias conversaciones",
    accounts: "Modelos para tus agentes",
  },
  {
    language: "en",
    settings: "Set up these apps",
    heading: "Chats with other apps",
    session: "Each app manages its own conversations",
    accounts: "Models for your agents",
  },
]) {
  for (const mode of ["light", "dark"] as const) {
    test(`la ayuda distingue chats y cuentas sin cortar el texto · ${copy.language} · ${mode}`, async ({ page }) => {
      await rpc("setup.finish");
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.prefs", JSON.stringify({ language }));
          localStorage.setItem("colonia.mode", mode);
        },
        { language: copy.language, mode },
      );
      await page.route("**/rpc/engines.status", (route) =>
        route.fulfill({ json: { ok: true, result: { engines: [] } } }),
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto("/#engine=claude");
      await page.getByRole("button", { name: copy.settings, exact: true }).last().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: copy.heading, exact: true })).toBeVisible();
      const help = dialog.locator(".config__lead");
      await expect
        .poll(() => help.evaluate((el) => el.closest("[data-colonia-mode]")?.getAttribute("data-colonia-mode")))
        .toBe(mode);
      await expect(help).toContainText(copy.session);
      await expect(help).toContainText(copy.accounts);
      for (const width of [390, 768, 960, 1200, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(
            () =>
              help.evaluate((el) => {
                const box = el.getBoundingClientRect();
                const action = el.closest(".config__head")?.querySelector("button")?.getBoundingClientRect();
                if (!action) return false;
                const text = document.createRange();
                text.selectNodeContents(el);
                const lines = Array.from(text.getClientRects());
                return (
                  document.documentElement.scrollWidth <= innerWidth + 1 &&
                  lines.length > 0 &&
                  lines.every(
                    (r) =>
                      r.width > 0 &&
                      r.left >= 0 &&
                      r.right <= innerWidth + 1 &&
                      r.left >= box.left - 1 &&
                      r.right <= box.right + 1 &&
                      r.top >= box.top - 1 &&
                      r.bottom <= box.bottom + 1 &&
                      (r.right <= action.left + 1 ||
                        r.left >= action.right - 1 ||
                        r.bottom <= action.top + 1 ||
                        r.top >= action.bottom - 1),
                  )
                );
              }),
            { message: `Toda la ayuda se lee a ${width} px` },
          )
          .toBe(true);
      }
    });
  }
}
