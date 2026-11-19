import { expect, open, test } from "./kit.ts";

test("el formulario A2A se adapta al ancho y solo acepta una tarjeta HTTPS", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Conectores/ }).click();
  const entry = page.getByRole("button", { name: "Conectar agente A2A" });
  const catalog = page.getByRole("button", { name: /Catálogo/ }).first();
  await expect(entry.or(catalog).first()).toBeVisible();
  if (!(await entry.isVisible())) await catalog.click();
  await entry.click();
  const form = page.getByRole("dialog", { name: "Conectar agente A2A" });
  await form.locator("#a2a-name").fill("contabilidad-e2e");
  const url = form.locator("#a2a-address");
  const save = form.getByRole("button", { name: "Guardar conexión" });
  await url.fill("http://invalido.example");
  await expect(save).toBeDisabled();
  await url.fill("https://contabilidad.example/.well-known/agent-card.json");
  await expect(save).toBeEnabled();
  for (const width of [390, 768, 960, 1200, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() =>
        form.evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 1,
        ),
      )
      .toBe(true);
  }
  await save.click();
  await expect(form).toBeHidden();
});
