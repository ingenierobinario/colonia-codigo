import { expect, open, rpc, test } from "./kit.ts";

const image = {
  name: "brief.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  ),
};
type Detail = { task: { id: string }; attachments: Array<{ media_id: string; name: string }> };

test("removing an image waits for its pending preview before deleting the file", async ({ page }) => {
  await rpc("setup.finish", {});
  const uploaded = await rpc<{ media: { id: string } }>("media.upload", {
    name: image.name,
    mime: image.mimeType,
    data: image.buffer.toString("base64"),
  });
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Northwind pending preview",
    attachments: [uploaded.media.id],
  });
  const detail = await rpc<Detail>("tasks.get", { task: task.id });
  const id = detail.attachments[0]?.media_id;
  expect(id).toBeDefined();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let previewStarted = false;
  let previewFinished = false;
  const deleteAfterPreview: boolean[] = [];
  await page.route("**/rpc/media.get", async (route) => {
    if (route.request().postDataJSON().id !== id) return route.continue();
    previewStarted = true;
    await held;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    previewFinished = true;
    await route.fulfill({ response });
  });
  await page.route("**/rpc/tasks.detach", async (route) => {
    if (route.request().postDataJSON().media_id === id) deleteAfterPreview.push(previewFinished);
    await route.continue();
  });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByText("Northwind pending preview", { exact: true }).click();
  const assets = page
    .getByRole("complementary", { name: "Northwind pending preview" })
    .getByRole("region", { name: "Adjuntos", exact: true });
  await expect.poll(() => previewStarted).toBe(true);
  try {
    await assets.getByRole("button", { name: "Quitar adjunto brief.png", exact: true }).click();
    await expect(assets.getByRole("img", { name: "brief.png", exact: true })).toBeHidden();
  } finally {
    release();
  }
  await expect.poll(() => deleteAfterPreview).toEqual([true]);
  await expect.poll(async () => (await rpc<Detail>("tasks.get", { task: task.id })).attachments).toEqual([]);
});

test("a refused detach restores the file and removing it never starts an unused download", async ({ page }) => {
  await rpc("setup.finish", {});
  const uploaded = await rpc<{ media: { id: string } }>("media.upload", {
    name: "retained.txt",
    mime: "text/plain",
    data: Buffer.from("Keep on refusal").toString("base64"),
  });
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Northwind refused detach",
    attachments: [uploaded.media.id],
  });
  const before = await rpc<Detail>("tasks.get", { task: task.id });
  const reads: string[] = [];
  await page.route("**/rpc/media.get", async (route) => {
    reads.push(route.request().postDataJSON().id);
    await route.continue();
  });
  await page.route("**/rpc/tasks.detach", (route) =>
    route.fulfill({
      json: { ok: false, error: { code: "unavailable", message: "Detach refused" } },
    }),
  );
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByText("Northwind refused detach", { exact: true }).click();
  const assets = page
    .getByRole("complementary", { name: "Northwind refused detach" })
    .getByRole("region", { name: "Adjuntos", exact: true });
  const remove = assets.getByRole("button", { name: "Quitar adjunto retained.txt", exact: true });
  await remove.click();
  await expect(assets.getByRole("alert")).toHaveText("Detach refused");
  await expect(assets.getByRole("button", { name: /^retained\.txt / })).toBeVisible();
  expect((await rpc<Detail>("tasks.get", { task: task.id })).attachments).toEqual(before.attachments);
  await page.unroute("**/rpc/tasks.detach");
  await remove.click();
  await expect.poll(async () => (await rpc<Detail>("tasks.get", { task: task.id })).attachments).toEqual([]);
  expect(reads).not.toContain(before.attachments[0]?.media_id);
});

test("task attachments persist across creation and reload, preview, download, and detach independently of comments", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  const view = page.getByRole("region", { name: "Tareas" });
  await view.getByRole("button", { name: "Nueva tarea" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind durable assets");
  await dialog.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles(image);
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(dialog).toBeHidden();
  await view.getByText("Northwind durable assets", { exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Northwind durable assets" });
  const assets = panel.getByRole("region", { name: "Adjuntos", exact: true });
  await expect(assets.getByRole("img", { name: "brief.png", exact: true })).toBeVisible();
  await assets.getByRole("img", { name: "brief.png", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "brief.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await assets
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Northwind attachment snapshot") });
  await expect(assets.getByRole("button", { name: /^notes\.txt / })).toBeVisible();
  const listed = await rpc<{ tasks: Array<{ id: string; title: string }> }>("tasks.list", {});
  const task = listed.tasks.find((t) => t.title === "Northwind durable assets");
  expect(task).toBeDefined();
  const detail = () => rpc<Detail>("tasks.get", { task: task?.id });
  await expect
    .poll(async () => (await detail()).attachments.map((a) => a.name).sort())
    .toEqual(["brief.png", "notes.txt"]);
  await page.reload();
  await expect(assets.getByRole("button", { name: /^notes\.txt / })).toBeVisible();
  const download = page.waitForEvent("download");
  await assets.getByRole("button", { name: /^notes\.txt / }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("notes.txt");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("Northwind attachment snapshot");
  await assets.getByRole("button", { name: "Quitar adjunto brief.png", exact: true }).click();
  await expect(assets.getByRole("img", { name: "brief.png", exact: true })).toBeHidden();
  await expect.poll(async () => (await detail()).attachments.map((a) => a.name).sort()).toEqual(["notes.txt"]);
});

test("task uploads show size errors and enforce the attachment count before creating", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Título" }).fill("Northwind upload validation");
  const input = dialog.getByLabel("Adjuntar archivos", { exact: true });
  await input.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(dialog.getByRole("alert")).toContainText("large.png");
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await input.setInputFiles(
    Array.from({ length: 21 }, (_, i) => ({
      name: `note-${i}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("A note"),
    })),
  );
  await expect(dialog.getByRole("alert")).toHaveText("Puedes adjuntar hasta 20 archivos aquí.");
  await input.setInputFiles(image);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Quitar adjunto brief.png", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "brief.png", exact: true })).toBeHidden();
});

test("existing tasks accept more than 20 attachments and stop at 50", async ({ page }) => {
  await rpc("setup.finish", {});
  const uploaded = await Promise.all(
    Array.from({ length: 49 }, (_, i) =>
      rpc<{ media: { id: string } }>("media.upload", {
        name: `asset-${i}.txt`,
        mime: "text/plain",
        data: Buffer.from(`Asset ${i}`).toString("base64"),
      }),
    ),
  );
  const ids = uploaded.map((a) => a.media.id);
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Northwind attachment capacity",
    attachments: ids.slice(0, 20),
  });
  await rpc("tasks.attach", { task: task.id, media_ids: ids.slice(20, 40) });
  await rpc("tasks.attach", { task: task.id, media_ids: ids.slice(40) });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByText("Northwind attachment capacity", { exact: true }).click();
  const assets = page
    .getByRole("complementary", { name: "Northwind attachment capacity" })
    .getByRole("region", { name: "Adjuntos" });
  await expect(assets.getByRole("button", { name: "Adjuntar archivos", exact: true })).toBeEnabled();
  await assets.getByLabel("Adjuntar archivos", { exact: true }).setInputFiles([
    { name: "extra-a.txt", mimeType: "text/plain", buffer: Buffer.from("A") },
    { name: "extra-b.txt", mimeType: "text/plain", buffer: Buffer.from("B") },
  ]);
  await expect(assets.getByRole("alert")).toHaveText("Puedes adjuntar hasta 50 archivos aquí.");
  await assets
    .getByLabel("Adjuntar archivos", { exact: true })
    .setInputFiles({ name: "last.txt", mimeType: "text/plain", buffer: Buffer.from("Last") });
  await expect(assets.getByRole("button", { name: /^last\.txt / })).toBeVisible();
  await expect(assets.getByRole("button", { name: "Adjuntar archivos", exact: true })).toBeDisabled();
  await expect.poll(async () => (await rpc<Detail>("tasks.get", { task: task.id })).attachments.length).toBe(50);
});
