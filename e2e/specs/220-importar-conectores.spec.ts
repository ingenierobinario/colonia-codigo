// IMPORTAR-CONECTORES-1 · Conexiones ofrece los conectores que el dueño ya tiene en sus otras IAs (aquí, un Cursor y
// un Claude Code de ejemplo en la carpeta del sandbox): se eligen, se pide la clave que falta y entran sin enseñarla.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, open, rpc, test, world } from "./kit.ts";

const SHOTS = process.env.COLONIA_E2E_SHOTS;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("conexiones: importa los conectores de las otras IAs, pide la clave que falta y no la enseña", async ({
  page,
}) => {
  const { dir } = await world.info();
  const files = [path.join(dir, ".cursor", "mcp.json"), path.join(dir, ".claude.json")];
  fs.mkdirSync(path.dirname(files[0] ?? ""), { recursive: true });
  fs.writeFileSync(
    files[0] ?? "",
    JSON.stringify({
      mcpServers: {
        acme: { url: "https://mcp.acme.example/mcp", headers: { Authorization: "Bearer acme-e2e-guardada" } },
        globex: { command: "node", args: ["globex.js"], env: { GLOBEX_API_KEY: "" } },
      },
    }),
  );
  fs.writeFileSync(
    files[1] ?? "",
    JSON.stringify({ mcpServers: { "acme-otra": { type: "http", url: "https://mcp.acme.example/mcp/" } } }),
  );
  try {
    await open(page);
    await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
    await page.getByRole("radio", { name: /^Conexiones/ }).click();
    const banner = page.getByTestId("conn-import");
    await expect(banner).toContainText("Tienes 2 conectores en tus otras IAs");
    await banner.getByRole("button", { name: "Importar" }).click();
    const dialog = page.getByRole("dialog", { name: "Traer conectores de tus otras IAs" });
    // El mismo servidor en Cursor y en Claude Code es una sola fila.
    await expect(dialog.getByText("En Claude Code y Cursor")).toBeVisible();
    await expect(dialog.getByText("Solo en este ordenador")).toBeVisible();
    // Claro y oscuro a los anchos de uso: ni el aviso ni la lista hacen scroll de lado.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [390, 960, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(dialog).toBeVisible();
        expect(await fits(page), `sin scroll de lado a ${width}px (${scheme})`).toBe(true);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `importar-${scheme}-${width}.png`) });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 800 });
    const confirm = dialog.getByRole("button", { name: "Importar 2" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Clave que pide (GLOBEX_API_KEY)").fill("nw-e2e-dada");
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(banner).toBeHidden();
    const servers = (await rpc<{ servers: Array<{ name: string; scope: string; vars?: unknown }> }>("mcp.list", {}))
      .servers;
    // Se llama como en la primera IA donde está (Claude Code), con la clave que solo tenía Cursor.
    const mine = servers.filter((s) => s.scope === "global");
    expect(mine.map((s) => s.name)).toEqual(expect.arrayContaining(["acme-otra", "globex"]));
    expect(mine.find((s) => s.name === "acme-otra")).toMatchObject({
      vars: [{ name: "mcp-acme-otra-Authorization", set: true }],
    });
    expect(JSON.stringify(servers)).not.toContain("acme-e2e-guardada");
    expect(JSON.stringify(servers)).not.toContain("nw-e2e-dada");
  } finally {
    for (const f of files) fs.rmSync(f, { force: true });
    for (const name of ["acme-otra", "globex"]) await rpc("mcp.set", { name, server: null }).catch(() => {});
  }
});
