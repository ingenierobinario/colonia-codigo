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
    await expect(page.getByRole("button", { name: "Configurar chats externos", exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: `Usar ${engine.plan} con mis agentes` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Con tu cuenta (recomendado)", { exact: true })).toBeVisible();
  });
}
