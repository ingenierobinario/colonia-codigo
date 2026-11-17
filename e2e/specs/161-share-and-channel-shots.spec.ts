// Compartir › Publicar y los asistentes de canal (Discord, Slack, ntfy, Matrix y uno sin guía propia, IRC) a 390, 768 y
// 1200, claro y oscuro: ninguna pantalla se desborda a lo ancho. REMATE_SHOTS=<carpeta> guarda cada paso.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.REMATE_SHOTS;
async function shot(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), name).toBeLessThanOrEqual(
    0,
  );
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

const KINDS = ["Discord", "Slack", "ntfy", "Matrix", "IRC"] as const;

for (const mode of ["light", "dark"] as const) {
  for (const width of [390, 768, 1200]) {
    const tag = `${mode[0]}${width}`;
    test(`Compartir › Publicar y asistentes de canal sin desbordes (${mode} ${width})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((m) => localStorage.setItem("colonia.mode", m), mode);
      await page.setViewportSize({ width, height: 900 });
      await rpc("setup.finish", {});
      await rpc("webhooks.set", { mode: "off" });
      const name = `Tienda ${tag}`;
      const { project } = await rpc<Result<"projects.create">>("projects.create", { name });
      try {
        await open(page, `#project=${project.id}`);
        await page.getByRole("button", { name, exact: true }).first().click({ button: "right" });
        await page.getByRole("menuitem", { name: "Compartir proyecto" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("radio", { name: "Publicar" }).click();
        await expect(dialog.getByRole("button", { name: "Crear enlace temporal" })).toBeVisible();
        await shot(page, `${tag}-pshare-1-inicial`);
        await dialog.getByText("Opciones avanzadas").click();
        await shot(page, `${tag}-pshare-2-avanzadas`);
        await rpc("webhooks.set", { mode: "custom", url: "https://colonia.example.com" });
        await expect(dialog.getByRole("button", { name: "Publicar", exact: true })).toBeEnabled({ timeout: 10_000 });
        await dialog.getByRole("button", { name: "Publicar", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "Dejar de publicar" })).toBeVisible();
        await shot(page, `${tag}-pshare-3-enlace`);
        await dialog.getByRole("button", { name: "Dejar de publicar" }).click();
        await page.keyboard.press("Escape");

        for (const kind of KINDS) {
          await open(page);
          await page.getByRole("button", { name: "Añadir canal" }).click();
          await page
            .getByRole("menuitem", { name: kind, exact: kind !== "Discord" && kind !== "Slack" })
            .first()
            .click();
          const next = page.getByRole("button", { name: "Siguiente" });
          for (let step = 1; step <= 6; step++) {
            await page.waitForTimeout(150);
            await shot(page, `${tag}-canal-${kind.toLowerCase()}-${step}`);
            if (!(await next.isVisible()) || !(await next.isEnabled())) break;
            await next.click();
          }
          await page.keyboard.press("Escape");
        }
      } finally {
        await rpc("projects.share", { project: project.id, shared: false }).catch(() => {});
        await rpc("webhooks.set", { mode: "off" });
      }
    });
  }
}
