// El paso 2 del primer arranque («¿Qué inteligencia usas ya?») a 390, 768 y 1200, claro y oscuro: los servicios por el
// nombre que la gente conoce (Claude, ChatGPT), sin jerga a la vista y sin desbordes. REMATE_SHOTS=<carpeta> guarda cada uno.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./kit.ts";

const shots = process.env.REMATE_SHOTS;

for (const mode of ["light", "dark"] as const) {
  for (const width of [390, 768, 1200]) {
    test(`primer arranque › inteligencia, sin jerga ni desbordes (${mode} ${width})`, async ({ page }) => {
      await page.addInitScript((m) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" }));
        localStorage.setItem("colonia.mode", m);
      }, mode);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: "Configuración inicial" }).click();
      const wizard = page.locator(".wiz");
      await wizard.locator("#welcome-start").click();
      await wizard.getByRole("button", { name: "Continuar" }).click();
      await expect(wizard.getByText("usas ya?")).toBeVisible();

      const text = await wizard.innerText();
      for (const jerga of ["Anthropic", "OpenAI", "crew", "cadena", "Modelos, por orden", "Plan de ChatGPT"]) {
        expect(text, jerga).not.toContain(jerga);
      }
      await expect(wizard.locator(".pcard").filter({ hasText: /^ChatGPTCon tu cuenta Plus o Pro/ })).toHaveCount(1);
      await expect(wizard.getByText("—", { exact: true })).toHaveCount(0);
      // El interruptor del consumo (un rayo sin texto) no pinta nada en una guía de bienvenida.
      await expect(wizard.locator(".engine-usage-switch")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `${mode[0]}${width}-setup-inteligencia.png`), fullPage: true });
      const fold = wizard.getByText("Elegir qué modelo va primero");
      if (await fold.count()) {
        await fold.click();
        await page.screenshot({ path: path.join(shots, `${mode[0]}${width}-setup-inteligencia-orden.png`), fullPage: true });
      }
    });
  }
}
