// Engines and models: the ChatGPT plan first among the model APIs (as Codex, signed in from Colonia, never removed), then
// the APIs, known ones shown before they are set up (and removable from the list). The CLIs live in External sessions,
// never in a picker of models for agents.
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("the ChatGPT plan comes first as Codex, fixed, and connects with its own sign-in", async ({ page }) => {
  await rpc("setup.finish", {});
  const status = await rpc<{ connected: boolean }>("chatgpt.status");
  expect(status.connected).toBe(false);
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
  await box.fill("motores y modelos");
  await page.getByRole("option", { name: /Motores y modelos/ }).click();
  const settings = page.getByRole("dialog", { name: "Configuración" });

  // No CLI card here and nothing to put a CLI in the router.
  await expect(settings.getByRole("button", { name: "Usarlo en el router" })).toHaveCount(0);
  const codex = settings.locator(".pgrid > .pcard").first();
  await expect(codex).toContainText("ChatGPT");
  await expect(codex).toContainText("Con tu cuenta Plus o Pro");
  await expect(codex).toContainText("Sin conectar");
  await expect(codex.getByRole("button", { name: "Quitar" })).toHaveCount(0);
  await expect(settings.getByText("Solo en Claude Code")).toHaveCount(0);

  // ChatGPT's setting comes first: the sign-in waits until the owner says it is on.
  await codex.getByRole("button", { name: "Conectar" }).click();
  const signIn = page.getByRole("dialog", { name: "Conectar tu cuenta de ChatGPT" });
  await expect(signIn).toContainText("separado del de la app de Codex");
  // Signing in is one click: ChatGPT's device-code setting is only a hint once a code is out, or after a refusal.
  const start = signIn.getByRole("button", { name: "Iniciar sesión con ChatGPT" });
  await expect(start).toBeEnabled();
  await expect(signIn.getByRole("checkbox")).toHaveCount(0);
  await signIn.getByRole("button", { name: "Cancelar" }).click();

  // MOTORES-LLANO-1: the services paid with a key go under «Con clave (avanzado)», folded until one has a key (this
  // world already has one, so it starts open; open it by its title otherwise).
  const keys = settings.getByTestId("engines-keys");
  if ((await keys.getAttribute("open")) === null) await keys.getByText("Con clave (avanzado)").click();
  await expect(keys).toHaveAttribute("open");
  // A known model API not set up yet has its card, named with a capital, and opens already filled in.
  const groq = settings.locator(".pcard.is-unset", { hasText: "Groq" });
  await expect(groq).toContainText("Sin configurar");
  await groq.getByRole("button", { name: "Configurar" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor" });
  await expect(dialog.getByRole("textbox", { name: "Dirección del servicio" })).toHaveValue(
    "https://api.groq.com/openai/v1",
  );
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  // A suggestion the owner does not want goes off the list.
  const mistral = settings.locator(".pcard.is-unset", { hasText: "Mistral" });
  await mistral.getByRole("button", { name: "Quitar Mistral de la lista" }).click();
  await expect(mistral).toHaveCount(0);

  // The CLIs are in External sessions.
  await settings.getByRole("button", { name: "Sesiones externas", exact: true }).click();
  await expect(settings.locator(".engine", { hasText: "Claude Code" })).toBeVisible();
});

test("a CLI is never offered as a model for agents or the router, and the core refuses one", async ({ page }) => {
  await expect(
    rpc("agents.update", { agent: "superagent", model_choice: { model: "codex", router: false } }),
  ).rejects.toThrow(/own chats/);
  await open(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await settings.getByRole("button", { name: "Router" }).click();
  await settings.getByRole("button", { name: "Añadir un modelo" }).click();
  const list = page.getByRole("listbox", { name: "Modelos" });
  await expect(list.locator('.mlist__opt[title="custom/fake-1"]')).toHaveText("Fake 1");
  await expect(list).not.toContainText("Claude Code");
});

test("a CLI's own screen sends its settings to External sessions", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Claude Code", exact: true }).first().click();
  await page.getByRole("button", { name: "Configurar chats externos", exact: true }).first().click();
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await expect(settings.locator(".engine", { hasText: "Claude Code" })).toBeVisible();
  await expect(settings.locator(".pcard--plan")).toHaveCount(0);
});
