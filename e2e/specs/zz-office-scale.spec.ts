import { expect, open, rpc, test } from "./kit.ts";

let colleague = "";

test.beforeAll(async () => {
  const info = test.info();
  colleague = `Scale colleague ${info.workerIndex} 0`;
  await rpc("setup.finish", {});
  for (let batch = 0; batch < 4; batch++) {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => rpc("projects.create", { name: `Office scale ${batch * 8 + i}` })),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        rpc("agents.create", {
          name: `Scale colleague ${info.workerIndex} ${batch * 12 + i}`,
          slug: `scale-colleague-${info.workerIndex}-${batch * 12 + i}`,
          role: "Office scale fixture",
          blob: "menta",
        }),
      ),
    );
  }
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
  await page.screenshot({ path: info.outputPath("office-many-projects.png"), fullPage: true });
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
  await chat.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(
    page.getByRole("button", { name: `Hablar con ${colleague}`, exact: true }).locator("img"),
  ).toHaveAttribute("src", /fox/);
});
