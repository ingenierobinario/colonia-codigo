import type { Page } from "@playwright/test";
import type { ProviderInfo, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

async function modelsSettings(page: Page) {
  await open(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
  await settings.getByRole("button", { name: "Modelos para tus agentes", exact: true }).click();
  return settings;
}

test("free model selection is explicit, cancellable and limited to the official service", async ({ page }) => {
  const before = await rpc("models.config");
  const settings = await modelsSettings(page);
  await expect(settings.getByText("Opciones con cuota gratuita", { exact: true })).toBeVisible();
  await expect(settings.locator(".pcard").filter({ hasText: "Ollama" })).toBeVisible();
  await expect(settings.locator(".pcard").filter({ hasText: "LM Studio" })).toBeVisible();
  await settings
    .locator(".pcard")
    .filter({ hasText: "OpenRouter" })
    .getByRole("button", { name: "Configurar" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor", exact: true });
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Free selection");
  const models = dialog.getByRole("textbox", { name: "Lista fija de modelos (opcional)" });
  await models.fill("previous-model");
  await dialog.getByRole("button", { name: "Usar modelos gratuitos" }).click();
  await expect(models).toHaveValue("openrouter/free");
  await dialog.getByRole("textbox", { name: "Dirección del servicio" }).fill("https://example.invalid/v1");
  await expect(dialog.getByRole("button", { name: "Usar modelos gratuitos" })).toHaveCount(0);
  await expect(models).toHaveValue("openrouter/free");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(
    (await rpc<{ providers: ProviderInfo[] }>("providers.list")).providers.some((p) => p.id === "free-selection"),
  ).toBe(false);
  expect(await rpc("models.config")).toEqual(before);
});

test("saving the free selection offers that model without changing the existing router", async ({ page }) => {
  const before = await rpc("models.config");
  try {
    const settings = await modelsSettings(page);
    await settings
      .locator(".pcard")
      .filter({ hasText: "OpenRouter" })
      .getByRole("button", { name: "Configurar" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Nuevo proveedor", exact: true });
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Free selection");
    await dialog.getByRole("textbox", { name: "Clave", exact: true }).fill("test-free-selection-key");
    await dialog.getByRole("button", { name: "Usar modelos gratuitos" }).click();
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const provider = (await rpc<{ providers: ProviderInfo[] }>("providers.list")).providers.find(
      (p) => p.id === "free-selection",
    );
    expect(provider?.models).toEqual(["openrouter/free"]);
    expect(provider?.key_set).toBe(true);
    await expect(settings.locator(".catalog")).toContainText("free-selection");
    await settings.locator(".catalog__engine").filter({ hasText: "Free selection" }).locator("summary").click();
    await expect(settings.locator(".catalog__ref").filter({ hasText: "free-selection/openrouter/free" })).toBeVisible();
    expect(await rpc("models.config")).toEqual(before);
  } finally {
    await rpc("providers.set", { id: "free-selection", provider: null });
  }
});

test("a local connection can be configured and answer a chat without a provider key", async ({ page }) => {
  const providers = await rpc<{ providers: ProviderInfo[] }>("providers.list");
  const fake = providers.providers.find((p) => p.id === "custom");
  if (!fake) throw new Error("Missing local model fixture");
  let thread: Thread | undefined;
  try {
    const settings = await modelsSettings(page);
    await settings.getByRole("button", { name: "Añadir proveedor", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo proveedor", exact: true });
    await dialog.getByRole("button", { name: "Ollama", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Clave", exact: true })).toHaveCount(0);
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Local no key");
    await dialog.getByRole("textbox", { name: "Dirección del servicio" }).fill(fake.base_url);
    await dialog.getByRole("textbox", { name: "Lista fija de modelos (opcional)" }).fill("fake-1");
    await dialog.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const saved = (await rpc<{ providers: ProviderInfo[] }>("providers.list")).providers.find(
      (p) => p.id === "local-no-key",
    );
    expect(saved?.needs_key).toBe(false);
    thread = await rpc<Thread>("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Local model without key",
    });
    await rpc("threads.model", { thread: thread.id, model_choice: { model: "local-no-key/fake-1", router: false } });
    await settings.getByRole("button", { name: "Cerrar", exact: true }).click();
    await open(page, `#thread=${thread.id}`);
    await page.getByRole("textbox", { name: /^Escríbele a/ }).fill("Hello from the local model");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(
      page.locator(".transcript").getByText("Got it: Hello from the local model", { exact: true }),
    ).toBeVisible();
  } finally {
    if (thread) await rpc("threads.cancel", { thread: thread.id });
    await rpc("providers.set", { id: "local-no-key", provider: null });
  }
});

for (const language of ["en", "es"] as const) {
  for (const width of [390, 1200]) {
    test(`model options remain readable in ${language} at ${width}px`, async ({ page }) => {
      await page.addInitScript((language) => {
        localStorage.setItem("colonia.prefs", JSON.stringify({ language }));
        localStorage.setItem("colonia.mode", "dark");
      }, language);
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.getByRole("button", { name: language === "es" ? /^Cuenta(?!s de IA)/ : /^Account(?!s)/ }).click();
      await page
        .getByRole("menuitem", { name: language === "es" ? /^Configuración(?! inicial)/ : /^Settings/ })
        .click();
      const settings = page.getByRole("dialog", {
        name: language === "es" ? "Configuración" : "Settings",
        exact: true,
      });
      const selectSection = async (name: string) => {
        if (width === 390) {
          await settings
            .getByRole("combobox", {
              name: language === "es" ? "Secciones de configuración" : "Settings sections",
            })
            .click();
          await page.getByRole("option", { name, exact: true }).click();
        } else {
          await settings.getByRole("button", { name, exact: true }).click();
        }
      };
      await selectSection(language === "es" ? "Modelos para tus agentes" : "Models for your agents");
      await settings
        .getByText(language === "es" ? "Opciones con cuota gratuita" : "Options with a free allowance", { exact: true })
        .scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const group of await settings.locator(".pgrid__group").all()) {
        expect(
          await group.evaluate((element) => {
            const heading = element.querySelector("h3")?.getBoundingClientRect();
            const hint = element.querySelector("p")?.getBoundingClientRect();
            return Boolean(heading && hint && heading.bottom <= hint.top);
          }),
        ).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`model-options-${language}-${width}.png`) });
      await selectSection(language === "es" ? "Chats con otras apps" : "Chats with other apps");
      await expect(settings.locator(".config__lead")).toContainText(
        language === "es" ? "Cada app gestiona sus propias conversaciones" : "Each app manages its own conversations",
      );
      await expect(settings.locator(".engine").filter({ hasText: "Claude Code" })).toBeVisible();
      expect((await settings.locator(".engine__kind").allTextContents()).join(" ")).not.toMatch(/\b(CLI|ACP)\b/);
      await page.screenshot({ path: test.info().outputPath(`other-app-chats-${language}-${width}.png`) });
    });
  }
}
