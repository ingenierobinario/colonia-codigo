// ROUTER-CLAUDE-1: Claude con la cuenta (Claude Code) vale para el router (#1, #2, reglas), el modelo de un agente y el
// superagente mientras está encendido; apagado se niega con un texto sin jerga, y Codex sigue solo en sus conversaciones.
import type { CatalogEngine, ModelChoice, RouterConfig } from "../../packages/protocol/src/domain.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("el router, un agente y el superagente aceptan Claude con la cuenta; apagado, no", async () => {
  await rpc("setup.finish");
  const saved = await rpc<{ default: ModelChoice; router: RouterConfig }>("models.config");
  const { engines } = await rpc<{ engines: (CatalogEngine & { for_agents?: boolean })[] }>("models.list", {
    refresh: true,
  });
  const claude = engines.find((e) => e.id === "claude");
  expect(claude?.available, "el SDK ha podido consultar el catálogo de prueba").toBe(true);
  expect(claude?.models.map((model) => model.id)).toContain("default");
  // El CLI falso no tiene sesión iniciada: no se ofrece a agentes ni al router.
  expect(claude?.for_agents).toBe(false);
  const ref = "claude/default";
  try {
    await rpc("models.set_config", { router: { chain: [ref], rules: [] } });
    await rpc("models.set_config", { router: { chain: ["custom/fake-1", ref], rules: [] } });
    await rpc("models.set_config", {
      router: { chain: ["custom/fake-1"], rules: [{ when: { keywords: ["revisa"] }, model: ref }] },
    });
    await rpc("models.set_config", { default: { model: ref, router: false } });
    await rpc("agents.update", { agent: "superagent", model_choice: { model: ref, router: false } });
    expect((await rpc<{ router: RouterConfig }>("models.config")).router.rules[0]?.model).toBe(ref);

    await rpc("claude.set_enabled", { enabled: false });
    await expect(rpc("models.set_config", { router: { chain: ["custom/fake-1", ref], rules: [] } })).rejects.toThrow(
      /switched off/,
    );
    await expect(
      rpc("agents.update", { agent: "superagent", model_choice: { model: ref, router: false } }),
    ).rejects.toThrow(/switched off/);
    await expect(
      rpc("models.set_config", { router: { chain: ["custom/fake-1", "codex/gpt-e2e"], rules: [] } }),
    ).rejects.toThrow(/own chats/);
  } finally {
    await rpc("claude.set_enabled", { enabled: true });
    await rpc("agents.update", { agent: "superagent", model_choice: null });
    await rpc("models.set_config", saved);
  }
});

test("si el núcleo se niega, el router lo dice en español y sin jerga", async ({ page }) => {
  await rpc("setup.finish");
  await open(page);
  await page.route("**/rpc/models.set_config", (route) =>
    route.fulfill({
      json: {
        ok: false,
        error: { code: "invalid_params", message: "claude runs only in its own sessions; pick a model API" },
      },
    }),
  );
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await settings.getByRole("button", { name: "Router" }).click();
  await settings.getByRole("button", { name: "Añadir un modelo" }).click();
  await page.getByRole("listbox", { name: "Modelos" }).locator('.mlist__opt[title="custom/fake-1"]').click();
  await settings.getByRole("button", { name: "Guardar router" }).click();
  const notice = page.getByText(/Claude Code solo funciona en sus propias conversaciones/);
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText("runs only");
  await expect(notice).not.toContainText("sessions");
});
