import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, rpc, test } from "./kit.ts";

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
