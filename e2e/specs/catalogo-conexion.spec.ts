import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, rpc, test, world } from "./kit.ts";

test("el catálogo permite completar una conexión pendiente sin reemplazar su configuración", async ({ page }) => {
  test.setTimeout(60000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalogo-mcp-"));
  const signed = path.join(dir, "signed");
  await rpc("setup.finish");
  try {
    await rpc("mcp.set", {
      name: "metaads",
      server: {
        command: process.execPath,
        args: [path.resolve("apps/core/src/mcp/fake-sign-in-server.test-support.mjs")],
        env: { SIGNED_FILE: signed, OPENED_LOG: path.join(dir, "opened") },
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
    await page.getByRole("radio", { name: /^Conectores/ }).click();
    await page.getByRole("button", { name: "Catálogo", exact: true }).click();
    const card = page.locator(".catalog__card").filter({ has: page.getByText("Meta Ads", { exact: true }) });
    const provider = page.getByRole("link", { name: "Abrir Meta Ads · Pipeboard", exact: true });
    await page.context().route("https://pipeboard.co/", (route) => route.fulfill({ body: "Proveedor de prueba" }));
    const popup = page.waitForEvent("popup");
    await provider.click();
    const providerPage = await popup;
    await expect(providerPage).toHaveURL("https://pipeboard.co/");
    await providerPage.close();
    await card.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByRole("link", { name: /sesión/i })).toHaveAttribute(
      "href",
      "https://shop.example.com/authorize?state=1",
      { timeout: 30000 },
    );
    await fs.writeFile(signed, "ok");
    await expect(page.locator(".resd").getByText("echo", { exact: true }).first()).toBeVisible({ timeout: 15000 });
  } finally {
    await rpc("mcp.set", { name: "metaads", server: null });
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Meta Ads heredado aparece una vez en Integraciones del proyecto con el logo de Meta", async ({ page }) => {
  await rpc("setup.finish");
  const { repo } = await world.info();
  const { project } = await rpc<{ project: { id: string } }>("projects.register", { path: repo });
  await rpc("mcp.set", { name: "meta-ads", server: { url: "https://example.invalid/mcp" } });
  try {
    await page.goto(`/#project=${project.id}&tab=resources`);
    await page.getByRole("radio", { name: /^Integraciones/ }).click();
    const row = page.locator(".int__row").filter({ has: page.getByText("Meta Ads", { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".colonia-intmark svg path").first()).toBeAttached();
    const enabled = row.getByRole("switch");
    await expect(enabled).toBeChecked();
    await enabled.click();
    await expect(enabled).not.toBeChecked();
    await enabled.click();
    await expect(enabled).toBeChecked();
  } finally {
    await rpc("mcp.set", { name: "meta-ads", server: null });
  }
});

test("CONECTAR-DESACTIVADO-1: «Conectar» vuelve a encender un conector desactivado sin cambiar su configuración", async ({
  page,
}) => {
  await rpc("setup.finish");
  await rpc("mcp.set", {
    name: "notion",
    server: { url: "https://example.invalid/propia", headers: { X: "y" }, enabled: false },
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
    await page.getByRole("radio", { name: /^Conectores/ }).click();
    await page.getByRole("button", { name: "Catálogo", exact: true }).click();
    const card = page.locator(".catalog__card").filter({ has: page.getByText("Notion", { exact: true }) });
    await card.getByRole("button", { name: "Conectar" }).click();
    await expect
      .poll(async () => {
        const { servers } = await rpc<{ servers: { name: string; enabled: boolean; target: string }[] }>(
          "mcp.list",
          {},
        );
        const s = servers.find((x) => x.name === "notion");
        return s && `${s.enabled} ${s.target}`;
      })
      .toBe("true https://example.invalid/propia");
  } finally {
    await rpc("mcp.set", { name: "notion", server: null });
  }
});
