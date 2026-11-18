import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

async function checkSummary(page: Page, language: "es" | "en") {
  const summary = page.getByTestId("pshare-flows");
  await expect(summary).toContainText(
    language === "es" ? "Flows que se importan apagados · 1" : "Flows imported switched off · 1",
  );
  for (const width of [390, 768, 960, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const measure = () =>
      summary.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll("p")].map((p) => {
          const range = document.createRange();
          range.selectNodeContents(p);
          return [...range.getClientRects()].map((r) => ({
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          }));
        });
        const all = rows.flat();
        return {
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          clipped: all.some(
            (r) => r.left < box.left - 1 || r.right > box.right + 1 || r.left < 0 || r.right > innerWidth + 1,
          ),
          overlap: rows.some(
            (r, i) => i > 0 && r.length > 0 && (rows[i - 1]?.at(-1)?.bottom ?? 0) > (r[0]?.top ?? 0) + 1,
          ),
        };
      });
    await expect
      .poll(measure, { message: `Ancho ${width}` })
      .toEqual({ pageOverflow: 0, clipped: false, overlap: false });
  }
}

for (const language of ["es", "en"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`el resumen de Flows se lee completo en cinco anchos (${language}, ${mode})`, async ({ page }) => {
      await page.addInitScript(
        ({ language, mode }) => {
          localStorage.setItem("colonia.mode", mode);
          const settings = JSON.parse(localStorage.getItem("colonia.prefs") ?? "{}");
          localStorage.setItem("colonia.prefs", JSON.stringify({ ...settings, language }));
        },
        { language, mode },
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await rpc("setup.finish", {});
      const name = `Paquete de Flows ${language} ${mode}`;
      const { project } = await rpc<Result<"projects.create">>("projects.create", { name });
      try {
        await rpc("flows.create", {
          project: project.id,
          name: "Recibir solicitudes",
          graph: {
            schemaVersion: 2,
            nodes: [
              { kind: "webhook", id: "entrada", label: "Entrada" },
              {
                kind: "http",
                id: "solicitar",
                label: "Solicitar",
                method: "GET",
                url: "https://ejemplo.invalid/prueba",
                headers: [],
                body: "",
                timeoutMs: 5000,
              },
            ],
            edges: [{ source: "entrada", target: "solicitar" }],
            layout: [],
          },
        });
        await open(page, `#project=${project.id}`);
        const row = page.getByRole("group", { name, exact: true });
        const more = page.getByRole("button", { name: language === "es" ? /^\d+ más$/ : /^\d+ more$/ });
        await expect(row.or(more).first()).toBeVisible();
        if (!(await row.isVisible())) await more.click();
        await row.click({ button: "right" });
        await page.getByRole("menuitem", { name: language === "es" ? "Compartir proyecto" : "Share project" }).click();
        await checkSummary(page, language);
        await page.keyboard.press("Escape");
      } finally {
        await rpc("projects.unregister", { project: project.id });
      }
      await open(page);
      await page
        .getByRole("button", { name: language === "es" ? "Nuevo proyecto" : "New project" })
        .first()
        .click();
      await page.getByRole("button", { name: language === "es" ? "Importar proyecto" : "Import project" }).click();
      await page.getByTestId("pshare-file").setInputFiles({
        name: "equipo.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "colonia-proyecto-1",
            exported_at: "2026-01-01",
            project: { name: "Equipo" },
            instructions: "",
            agents: [],
            skills: [],
            connections: [],
            organization: {
              areas: [],
              roles: [],
              flows: [
                { key: "a".repeat(32), name: "Recibir", predicates: [], tableKey: "actual", action: { kind: "none" } },
              ],
              flowReview: ["settings", "knowledge", "agents", "tables", "versions"],
            },
          }),
        ),
      });
      await checkSummary(page, language);
    });
  }
}
