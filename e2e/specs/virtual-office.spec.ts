import type { Agent } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("the office shows real departments and opens a working chat without leaving the office", async ({
  page,
}, info) => {
  const guideName = `Office Guide ${info.retry}`;
  await rpc("setup.finish", {});
  await rpc<Agent>("agents.create", {
    slug: `office-guide-${info.retry}`,
    name: guideName,
    role: "Helps in the office",
    area: "design",
    blob: "menta",
  });
  await rpc("org.set", { organization: { areas: [{ slug: "design", name: "Diseño" }], roles: [] } });
  await open(page, "#view=office");
  await expect(page.getByRole("heading", { name: "Tu colonia, en un mismo lugar" })).toBeVisible();
  await expect(
    page
      .locator(".office-room-labels")
      .filter({ hasText: "Diseño" })
      .getByRole("button", { name: `Hablar con ${guideName}` }),
  ).toBeVisible();
  await expect(page.locator(".office-3d canvas")).toBeVisible();
  await page.getByRole("button", { name: "Pausar movimiento" }).click();
  await expect(page.getByRole("button", { name: "Reanudar movimiento" })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".office-person img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
  });
  await page.screenshot({ path: info.outputPath("office-desktop-es.png"), fullPage: true });
  await page.getByRole("button", { name: `Hablar con ${guideName}` }).click();
  const chat = page.frameLocator(`iframe[title="Hablar con ${guideName}"]`);
  const input = chat.getByRole("textbox", { name: /^Escríbele a/ });
  await input.fill("Office chat works");
  await input.press("Enter");
  await expect(chat.locator(".transcript").getByText("Got it: Office chat works")).toBeVisible();
  expect(page.url()).toContain("#view=office");
  await page
    .getByRole("complementary", { name: `Hablar con ${guideName}` })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  const person = page.getByRole("button", { name: `Hablar con ${guideName}` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(person).toBeVisible();
  await page.screenshot({ path: info.outputPath("office-phone-es.png"), fullPage: true });
  await page.getByRole("button", { name: "Lista del equipo", exact: true }).click();
  await expect(page.locator(".office-roster__person").filter({ hasText: guideName })).toBeVisible();
});

for (const avatar of [
  { slug: "person", category: "Personas", label: "Persona 1", image: /person-1/ },
  { slug: "animal", category: "Animales", label: "Zorro", image: /fox/ },
]) {
  test(`an agent's ${avatar.slug} avatar updates from the office chat`, async ({ page }, info) => {
    await rpc("setup.finish", {});
    const name = `Avatar ${avatar.slug} ${info.retry}`;
    await rpc("agents.create", {
      slug: `office-avatar-${avatar.slug}-${info.retry}`,
      name,
      role: "Office avatar fixture",
      blob: "menta",
    });
    await open(page, "#view=office");
    await page.getByRole("button", { name: "Pausar movimiento" }).click();
    await page.getByRole("textbox", { name: "Buscar un compañero" }).fill(name);
    await page.getByRole("button", { name: `Hablar con ${name}`, exact: true }).click();
    const chat = page.frameLocator(`iframe[title="Hablar con ${name}"]`);
    await chat.getByRole("button", { name: "Editar agente y avatar" }).click();
    await chat.getByRole("button", { name: avatar.category, exact: true }).click();
    await chat.getByRole("button", { name: avatar.label, exact: true }).click();
    await chat.getByRole("button", { name: "Guardar y cerrar" }).click();
    await expect(page.getByRole("button", { name: `Hablar con ${name}`, exact: true }).locator("img")).toHaveAttribute(
      "src",
      avatar.image,
    );
  });
}

test("a new business has its own office and opens its own application context", async ({ page }, info) => {
  const name = `Second business ${info.retry}`;
  const renamed = `Renamed business ${info.retry}`;
  await rpc("setup.finish", {});
  await open(page, "#view=office");
  await page.getByRole("button", { name: "Nuevo espacio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo espacio" });
  await dialog.getByRole("textbox").fill(name);
  const ready = page.waitForResponse(
    (response) => response.url().endsWith("/rpc/workspaces.snapshot") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Crear espacio", exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await (await ready).json()).ok).toBe(true);
  await page.getByRole("button", { name: "Renombrar espacio", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Renombrar espacio" });
  await rename.getByRole("textbox").fill(renamed);
  await rename.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("button", { name: renamed, exact: true })).toHaveAttribute("aria-pressed", "true");
  // A fresh core seeds its secretary, Scout and Vera; it must not inherit the root's custom agent.
  await expect(page.locator(".office-statusbar")).toContainText("3 compañeros");
  await expect(page.locator(".office-person")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Hablar con Office Guide/ })).toHaveCount(0);
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

test("a business can rename itself and open its own office chat", async ({ page }, info) => {
  const { workspace } = await rpc<{ workspace: { id: string } }>("workspaces.create", {
    name: `Own context ${info.retry}`,
  });
  const prefix = `/workspaces/${workspace.id}`;
  const response = await page.request.post(`${prefix}/rpc/setup.finish`, {
    headers: { "idempotency-key": `office-child-setup-${workspace.id}` },
    data: {},
  });
  expect((await response.json()).ok).toBe(true);
  await open(page, `workspaces/${workspace.id}/#view=office`);
  await expect(page).toHaveURL(/\/workspaces\/w_[a-f0-9]{32}\//);
  await page.getByRole("button", { name: "Renombrar espacio", exact: true }).click();
  const childRename = page.getByRole("dialog", { name: "Renombrar espacio" });
  await childRename.getByRole("textbox").fill("Own business");
  await childRename.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("button", { name: "Own business", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lista del equipo", exact: true }).click();
  await page.locator(".office-roster__person").first().click();
  await expect(page.locator(".office-drawer iframe")).toHaveAttribute(
    "src",
    /^\/workspaces\/w_[a-f0-9]{32}\/\?officeChat=/,
  );
  const childChat = page.frameLocator(".office-drawer iframe");
  const childInput = childChat.getByRole("textbox", { name: /^Escríbele a/ });
  await expect(childInput).toBeVisible();
});

test("the main workspace name persists without renaming its base project", async ({ page }) => {
  await rpc("setup.finish", {});
  const before = await rpc("projects.list");
  await open(page, "#view=office");
  await page.getByRole("button", { name: "Renombrar espacio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Renombrar espacio" });
  await dialog.getByRole("textbox").fill("Acme headquarters");
  await dialog.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("button", { name: "Acme headquarters", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Acme headquarters", exact: true })).toBeVisible();
  expect(await rpc("projects.list")).toEqual(before);
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

test("a large office keeps agents searchable and opens their chat", async ({ page }, info) => {
  test.setTimeout(60000);
  const before = await rpc<{ agents: Agent[] }>("agents.list");
  for (let i = 0; i < 27; i++)
    await rpc("agents.create", {
      slug: `studio-${i}`,
      name: `Teammate ${i + 1}`,
      role: "Office teammate",
      area: i < 14 ? "design" : "operations",
      blob: i % 3 === 0 ? "fox" : i % 3 === 1 ? "person-3" : "menta",
    });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, "#view=office");
  await expect(page.locator(".office-3d canvas")).toBeVisible();
  await page.getByRole("button", { name: "Pausar movimiento" }).click();
  await expect(page.locator(".office-person")).toHaveCount(before.agents.length + 27);
  await page.screenshot({ path: info.outputPath("office-large-team.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Buscar un compañero" }).fill("Teammate 27");
  await page.getByRole("button", { name: "Hablar con Teammate 27", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Hablar con Teammate 27"]').getByRole("textbox", { name: /^Escríbele a/ }),
  ).toBeVisible();
});

for (const operation of ["rename", "create"] as const) {
  test(`a delayed directory read cannot undo a confirmed ${operation}`, async ({ page }, info) => {
    await rpc("setup.finish", {});
    const suffix = `${info.repeatEachIndex}-${info.retry}`;
    const existing = `Existing ${operation} business ${suffix}`;
    await rpc("workspaces.create", { name: existing });
    const held = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    await page.route(
      "**/rpc/workspaces.list",
      async (route) => {
        const response = await route.fetch();
        ready.resolve();
        await held.promise;
        try {
          await route.fulfill({ response });
        } finally {
          completed.resolve();
        }
      },
      { times: 1 },
    );
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, "#view=office");
      await ready.promise;
      const title = operation === "rename" ? "Renombrar espacio" : "Nuevo espacio";
      await page.getByRole("button", { name: title, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title });
      const name = `${operation === "rename" ? "Current workspace" : "Current business"} ${suffix}`;
      await dialog.getByRole("textbox").fill(name);
      await dialog
        .getByRole("button", { name: operation === "rename" ? "Guardar nombre" : "Crear espacio", exact: true })
        .click();
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      held.resolve();
      await completed.promise;
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: existing, exact: true })).toBeVisible();
    } finally {
      held.resolve();
    }
  });
}
