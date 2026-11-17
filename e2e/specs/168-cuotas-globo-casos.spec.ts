import { expect, open, rpc, test } from "./kit.ts";

// REV-CUOTAS-1: el globo «Cuotas de IA» en todos sus casos. La barra mide lo que QUEDA (igual que el texto «X%
// disponible» y que el indicador de la barra superior), un motor sin fuente de cuota no aparece, y ningún estado
// técnico («uso no disponible», «Sin fuente de cuota compatible») llega a la vista.

const engine = (id: string, label: string, extra: Record<string, unknown>) => ({
  id,
  label,
  cli_installed: true,
  available: false,
  status: "unavailable",
  source: "none",
  windows: [],
  ...extra,
});
const ok = (id: string, label: string, used: [number, number]) =>
  engine(id, label, {
    available: true,
    status: "ok",
    source: id === "claude" ? "claude_cli" : "codex_app_server",
    windows: [
      { id: "primary", used_percent: used[0], window_minutes: 300, resets_at: "2030-01-01T17:00:00.000Z" },
      { id: "secondary", used_percent: used[1], window_minutes: 10080, resets_at: "2030-01-05T09:00:00.000Z" },
    ],
  });

const CASES: Array<[string, unknown[], (s: import("@playwright/test").Locator) => Promise<void>]> = [
  [
    "Claude sin sesión y Codex sin sesión",
    [engine("claude", "Claude", { reason: "signed_out" }), engine("codex", "Codex", { reason: "signed_out" })],
    async (s) => {
      await expect(s.getByText("Sin sesión iniciada")).toHaveCount(2);
    },
  ],
  [
    "nada instalado",
    [
      engine("claude", "Claude", { cli_installed: false, reason: "cli_not_found" }),
      engine("codex", "Codex", { cli_installed: false, reason: "cli_not_found" }),
    ],
    async (s) => {
      await expect(s.locator(".colonia-meter")).toHaveCount(0);
    },
  ],
  [
    "0% disponible",
    [ok("claude", "Claude", [100, 100])],
    async (s) => {
      await expect(s.getByRole("img", { name: "Claude · 5 horas: 0% disponible" })).toBeVisible();
      const fill = await s
        .locator(".engine-usage__meter .colonia-meter__fill")
        .first()
        .evaluate((el) => (el as HTMLElement).style.width);
      expect(Number.parseFloat(fill)).toBe(0);
    },
  ],
  [
    "100% disponible y fechas de renovación",
    [ok("codex", "Codex", [0, 0])],
    async (s) => {
      await expect(s.getByRole("img", { name: "Codex · 5 horas: 100% disponible" })).toBeVisible();
      const fill = await s
        .locator(".engine-usage__meter .colonia-meter__fill")
        .first()
        .evaluate((el) => (el as HTMLElement).style.width);
      expect(Number.parseFloat(fill)).toBe(100);
      await expect(s.getByText(/Se renueva/).first()).toBeVisible();
    },
  ],
  [
    "Kimi y otras IAs sin fuente de cuota no aparecen",
    [ok("claude", "Claude", [15, 87]), engine("acp:kimi", "Kimi", { reason: "unsupported" })],
    async (s) => {
      await expect(s).not.toContainText("Kimi");
      await expect(s.getByRole("img", { name: "Claude · 5 horas: 85% disponible" })).toBeVisible();
      await expect(s.getByRole("img", { name: "Claude · Semanal: 13% disponible" })).toBeVisible();
    },
  ],
  [
    "Codex con sesión pero sin datos ahora",
    [engine("codex", "Codex", { reason: "not_available" })],
    async (s) => {
      await expect(s.getByText("Sin datos de cuota ahora mismo")).toBeVisible();
    },
  ],
];

for (const scheme of ["light", "dark"] as const)
  for (const width of [390, 768, 960, 1200, 1440])
    test(`globo de cuotas en todos sus casos · ${scheme} · ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await rpc("setup.finish");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 860 });
      let current: unknown[] = [];
      await page.route("**/rpc/engines.usage", (route) =>
        route.fulfill({ json: { ok: true, result: { checked_at: "2030-01-01T12:00:00.000Z", engines: current } } }),
      );
      await open(page);
      for (const [name, engines, check] of CASES) {
        current = engines;
        await page.getByTestId("engine-usage-button").click();
        const summary = page.getByTestId("engine-usage-summary");
        await summary.getByRole("button", { name: "Actualizar" }).click();
        await test.step(name, () => check(summary));
        await expect(summary, name).not.toContainText(/uso no disponible|Sin fuente de cuota|engine|token/i);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(wide, `${name}: la página se sale de lado`).toBeLessThanOrEqual(1);
        const box = await summary.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `${name}: el globo cabe`).toBeTruthy();
        await page.keyboard.press("Escape");
      }
    });

// El interruptor «Ver cuánto me queda» apagado lo cubre 100-engine-usage-preferences.spec.ts.
