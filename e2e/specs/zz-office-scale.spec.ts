import { expect, open, rpc, test } from "./kit.ts";

const colleague = "Scale colleague 0";

test.beforeAll(async () => {
  await rpc("setup.finish", {});
  const [projects, agents] = await Promise.all([
    rpc<{ projects: { name: string }[] }>("projects.list"),
    rpc<{ agents: { id: string }[] }>("agents.list"),
  ]);
  const names = new Set(projects.projects.map((project) => project.name));
  const ids = new Set(agents.agents.map((agent) => agent.id));
  // Retries restart the worker, not the shared core. Reuse this fixture instead of enlarging it on each retry.
  for (let batch = 0; batch < 4; batch++) {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => `Office scale ${batch * 8 + i}`)
        .filter((name) => !names.has(name))
        .map((name) => rpc("projects.create", { name })),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => batch * 12 + i)
        .filter((i) => !ids.has(`scale-colleague-${i}`))
        .map((i) =>
          rpc("agents.create", {
            name: `Scale colleague ${i}`,
            slug: `scale-colleague-${i}`,
            role: "Office scale fixture",
            blob: "menta",
          }),
        ),
    );
  }
  const prepared = await rpc<{ agents: { id: string }[] }>("agents.list");
  expect(prepared.agents.filter((agent) => agent.id.startsWith("scale-colleague-"))).toHaveLength(48);
  await rpc("agents.update", { agent: "scale-colleague-0", blob: "menta" });
});

test("a many-project office keeps workspace editing responsive", async ({ page }, info) => {
  const name = `Large office ${info.workerIndex}-${info.retry}`;
  await open(page, "#view=office");
  await expect(page.locator(".office-3d canvas")).toBeVisible();
  await page.getByRole("button", { name: "Renombrar espacio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Renombrar espacio" });
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pausar movimiento" }).click();
  const labels = await page.locator(".office-3d__person").evaluateAll((nodes, prefix) => {
    const visible = nodes.filter((node) => getComputedStyle(node).visibility === "visible");
    const boxes = visible.map((node) => node.getBoundingClientRect());
    return {
      colleagues: visible.filter((node) => node.getAttribute("data-person")?.startsWith(prefix)).length,
      overlaps: boxes.some((box, i) =>
        boxes
          .slice(i + 1)
          .some(
            (other) =>
              box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
          ),
      ),
    };
  }, "scale-colleague-");
  expect(labels.colleagues).toBe(48);
  expect(labels.overlaps).toBe(false);
  const zoomCovered = await page.locator(".office-zoom").evaluate((zoom) => {
    const control = zoom.getBoundingClientRect();
    return [...document.querySelectorAll(".office-3d__person, .office-3d__room")].some((node) => {
      if (getComputedStyle(node).visibility !== "visible") return false;
      const box = node.getBoundingClientRect();
      return (
        box.left < control.right && box.right > control.left && box.top < control.bottom && box.bottom > control.top
      );
    });
  });
  expect(zoomCovered).toBe(false);
  await page.screenshot({ path: info.outputPath("office-many-projects.png"), fullPage: true });
});

test("a moving colleague remains clickable without pausing the office", async ({ page }) => {
  await open(page, "#view=office");
  await page.getByRole("textbox", { name: "Buscar un compañero" }).fill(colleague);
  const person = page.getByRole("button", { name: `Hablar con ${colleague}`, exact: true });
  await expect(person).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar movimiento" })).toHaveAttribute("aria-pressed", "true");
  const rect = await person.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) throw new Error("Visible colleague has no bounds");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await person.click();
  await expect(
    page.frameLocator(`iframe[title="Hablar con ${colleague}"]`).getByRole("textbox", { name: /^Escríbele a/ }),
  ).toBeVisible();
});

test("a many-project office can edit an avatar through its chat", async ({ page }) => {
  await open(page, "#view=office");
  await page.getByRole("button", { name: "Pausar movimiento" }).click();
  await page.getByRole("textbox", { name: "Buscar un compañero" }).fill(colleague);
  await page.getByRole("button", { name: `Hablar con ${colleague}`, exact: true }).click();
  const chat = page.frameLocator(`iframe[title="Hablar con ${colleague}"]`);
  await chat.getByRole("button", { name: "Editar agente y avatar" }).click();
  await chat.getByRole("button", { name: "Animales", exact: true }).click();
  await chat.getByRole("button", { name: "Zorro", exact: true }).click();
  const canvas = await page.locator(".office-3d canvas").elementHandle();
  expect(canvas).not.toBeNull();
  await chat.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(
    page.getByRole("button", { name: `Hablar con ${colleague}`, exact: true }).locator("img"),
  ).toHaveAttribute("src", /fox/);
  expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
});
