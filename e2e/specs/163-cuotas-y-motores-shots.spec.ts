// CUOTA-CLAUDE-1 y MOTORES-LLANO-1: el desplegable «Cuotas de IA» con ChatGPT (Codex) y Claude, y Ajustes › Motores y
// modelos en dos grupos llanos, a 390/768/1200, claro y oscuro, sin jerga ni desbordes. REMATE_SHOTS=<carpeta> guarda cada uno.
import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.REMATE_SHOTS;
const report = {
  checked_at: "2026-11-17T12:00:00.000Z",
  engines: [
    {
      id: "codex",
      label: "Codex",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "codex_app_server",
      windows: [{ id: "secondary", used_percent: 15, window_minutes: 10080, resets_at: "2026-11-20T08:00:00.000Z" }],
    },
    {
      id: "claude",
      label: "Claude",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "claude_cli",
      windows: [
        { id: "primary", used_percent: 42, window_minutes: 300, resets_at: "2026-11-17T15:00:00.000Z" },
        { id: "secondary", used_percent: 61, window_minutes: 10080, resets_at: "2026-11-18T22:00:00.000Z" },
      ],
    },
  ],
};
const save = async (page: import("@playwright/test").Page, name: string) => {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
};
const noOverflow = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

for (const mode of ["light", "dark"] as const) {
  for (const width of [390, 768, 1200]) {
    test(`cuotas de IA › Claude junto a ChatGPT (${mode} ${width})`, async ({ page }) => {
      await rpc("setup.finish");
      await page.addInitScript((m) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" }));
        localStorage.setItem("colonia.mode", m);
      }, mode);
      await page.route("**/rpc/engines.usage", (route) => route.fulfill({ json: { ok: true, result: report } }));
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.getByTestId("engine-usage-button").click();
      const summary = page.getByTestId("engine-usage-summary");
      const claude = summary.locator("section").filter({ has: page.getByRole("heading", { name: "Claude" }) });
      await expect(claude.getByText("58% disponible")).toBeVisible();
      await expect(claude.getByText("39% disponible")).toBeVisible();
      await expect(claude.getByText("5 horas", { exact: true })).toBeVisible();
      await expect(claude.getByText(/Se renueva/)).toHaveCount(2);
      await expect(summary.getByRole("button", { name: "Gestionar IAs" })).toBeVisible();
      await expect(summary).not.toContainText("engines");
      await noOverflow(page);
      await save(page, `${mode[0]}${width}-cuotas.png`);
    });

    test(`modelos para tus agentes › dos grupos llanos (${mode} ${width})`, async ({ page }) => {
      await rpc("setup.finish");
      await page.addInitScript((m) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language: "es" }));
        localStorage.setItem("colonia.mode", m);
      }, mode);
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      // Por el buscador, que lleva a la sección igual en el móvil (donde las secciones van en un desplegable).
      await page.keyboard.press("ControlOrMeta+k");
      const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
      await box.fill("modelos para tus agentes");
      await page.getByRole("option", { name: /Modelos para tus agentes/ }).click();
      const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
      await expect(settings.getByRole("heading", { name: "Con tu cuenta", exact: true })).toBeVisible();
      const plans = settings.locator(".pcard--plan");
      await expect(plans).toHaveCount(2);
      for (const plan of [plans.nth(0), plans.nth(1)]) {
        await expect(plan.locator("dt")).toHaveText(["Cuenta", "Modelos"]);
        await expect(plan.getByRole("switch", { name: "Ver cuánto me queda" })).toHaveCount(1);
        await expect(plan.getByRole("switch", { name: "Activo", exact: true })).toHaveCount(1);
      }
      const text = await settings.innerText();
      for (const jerga of ["APIs", "loop", "token", "CLIs", "engines", "Dirección del servicio", "Consumo"]) {
        expect(text, jerga).not.toContain(jerga);
      }
      await save(page, `${mode[0]}${width}-motores.png`);
      const keys = settings.getByTestId("engines-keys");
      await expect(keys.getByText("Opciones con cuota gratuita", { exact: true })).toBeVisible();
      await expect(keys.getByText("Modelos locales", { exact: true }).first()).toBeVisible();
      const unset = keys.locator(".pcard").filter({ hasText: "Sin clave" });
      for (const card of await unset.all()) {
        await expect(card.getByRole("switch")).toHaveCount(0);
        await expect(card.getByRole("button", { name: "Añadir clave" })).toBeVisible();
      }
      expect(await keys.innerText()).not.toMatch(/Clave\s*—|Auto\b|Dirección del servicio/);
      await noOverflow(page);
      await save(page, `${mode[0]}${width}-motores-clave.png`);
    });
  }
}
