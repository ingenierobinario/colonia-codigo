import type { Agent } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("the office shows real departments and opens a working chat without leaving the office", async ({
  page,
}, info) => {
  await rpc("setup.finish", {});
  await rpc<Agent>("agents.create", {
    slug: "office-guide",
    name: "Office Guide",
    role: "Helps in the office",
    area: "design",
    blob: "menta",
  });
  await rpc("org.set", { organization: { areas: [{ slug: "design", name: "Diseño" }], roles: [] } });
  await open(page, "#view=office");
  await expect(page.getByRole("heading", { name: "Tu colonia, en un mismo lugar" })).toBeVisible();
  await expect(
    page.locator(".office-room").filter({ hasText: "Diseño" }).getByRole("button", { name: "Hablar con Office Guide" }),
  ).toBeVisible();
  await page.locator(".office-person img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
  });
  await page.screenshot({ path: info.outputPath("office-desktop-es.png"), fullPage: true });
  await page.getByRole("button", { name: "Hablar con Office Guide" }).click();
  const chat = page.frameLocator('iframe[title="Hablar con Office Guide"]');
  const input = chat.getByRole("textbox", { name: /^Escríbele a/ });
  await input.fill("Office chat works");
  await input.press("Enter");
  await expect(chat.locator(".transcript").getByText("Got it: Office chat works")).toBeVisible();
  expect(page.url()).toContain("#view=office");
  await chat.getByRole("button", { name: "Editar agente y avatar" }).click();
  await chat.getByRole("button", { name: "Personas", exact: true }).click();
  await chat.getByRole("button", { name: "Persona 1", exact: true }).click();
  await chat.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(page.getByRole("button", { name: "Hablar con Office Guide" }).locator("img")).toHaveAttribute(
    "src",
    /person-1/,
  );
  await chat.getByRole("button", { name: "Editar agente y avatar" }).click();
  await chat.getByRole("button", { name: "Animales", exact: true }).click();
  await chat.getByRole("button", { name: "Zorro", exact: true }).click();
  await chat.getByRole("button", { name: "Guardar y cerrar" }).click();
  await page
    .getByRole("complementary", { name: "Hablar con Office Guide" })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  const person = page.getByRole("button", { name: "Hablar con Office Guide" });
  await expect(person.locator("img")).toHaveAttribute("src", /fox/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(person).toBeVisible();
  await page.screenshot({ path: info.outputPath("office-phone-es.png"), fullPage: true });
  await page.getByRole("button", { name: "Lista del equipo", exact: true }).click();
  await expect(page.locator(".office-roster__person").filter({ hasText: "Office Guide" })).toBeVisible();
});

test("a new business has its own office and opens its own application context", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page, "#view=office");
  await page.getByRole("button", { name: "Nuevo espacio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo espacio" });
  await dialog.getByRole("textbox").fill("Second business");
  const ready = page.waitForResponse(
    (response) => response.url().endsWith("/rpc/workspaces.snapshot") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Crear espacio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Second business", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await (await ready).json()).ok).toBe(true);
  // A fresh core seeds its secretary, Scout and Vera; it must not inherit the root's custom agent.
  await expect(page.locator(".office-statusbar")).toContainText("3 compañeros");
  await expect(page.locator(".office-person")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Hablar con Office Guide" })).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir espacio", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/w_[a-f0-9]{32}\//);
  const result = await page.evaluate(async () => {
    const prefix = location.pathname.replace(/\/$/, "");
    const res = await fetch(prefix + "/rpc/workspaces.list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return res.json();
  });
  expect(result.result.workspaces).toEqual([]);
});

test("the English office stays usable in dark mode and on a narrow screen", async ({ page }, info) => {
  await rpc("setup.finish", {});
  await page.addInitScript(() => {
    localStorage.setItem("colonia.prefs", JSON.stringify({ language: "en", look: "minimal" }));
    localStorage.setItem("colonia.mode", "dark");
  });
  await open(page, "#view=office");
  await expect(page.getByRole("heading", { name: "Your colony, together" })).toBeVisible();
  await page.locator(".office-person img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
  });
  await page.screenshot({ path: info.outputPath("office-desktop-en-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("office-phone-en-dark.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Find a teammate" }).fill("Nobody has this name");
  await expect(page.getByRole("status")).toHaveText("No teammates match your search.");
  await page.getByRole("textbox", { name: "Find a teammate" }).fill("");
  await expect(page.locator(".office-person").first()).toBeVisible();
});
