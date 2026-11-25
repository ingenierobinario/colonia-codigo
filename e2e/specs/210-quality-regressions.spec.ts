import type { Route } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath("current-state.png") });
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("A slow screen download announces loading instead of leaving the main area empty", async ({ page }, info) => {
  let pending: Route | undefined;
  await page.route("**/assets/TasksScreen-*.js", (route) => {
    pending = route;
  });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.locator("main").getByRole("status")).toContainText("Cargando");
  await page.screenshot({ path: info.outputPath("loading.png") });
  await pending?.continue();
  await expect(page.locator("main").getByRole("status")).toHaveCount(0);
  await expect(page.locator("main").getByRole("region", { name: "Tareas", exact: true })).toBeVisible();
});

test("Changing a search removes the previous query's actionable message hits", async ({ page }) => {
  let pending: Route | undefined;
  await page.route("**/rpc/threads.search", async (route) => {
    if (route.request().postDataJSON().query === "second-query") {
      pending = route;
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        result: {
          hits: [{ thread_id: "quality-thread", message_id: "quality-message", snippet: "first-query old answer" }],
        },
      },
    });
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("textbox", { name: "Buscar", exact: true });
  await search.fill("first-query");
  const oldHit = page.getByRole("option", { name: /first-query old answer/ });
  await expect(oldHit).toBeVisible();
  await search.fill("second-query");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(oldHit).toHaveCount(0);
  await pending?.fulfill({ json: { ok: true, result: { hits: [] } } });
});

test("A late file filter response cannot replace the current filter's error state", async ({ page }) => {
  let pending: Route | undefined;
  await page.route("**/rpc/media.shared", async (route) => {
    const { kind } = route.request().postDataJSON();
    if (kind === "image") {
      pending = route;
      return;
    }
    if (kind === "document") {
      await route.fulfill({ json: { ok: false, error: { code: "INTERNAL", message: "quality-current-error" } } });
      return;
    }
    await route.fulfill({
      json: { ok: true, result: { items: [], counts: { image: 0, video: 0, audio: 0, document: 0 }, more: false } },
    });
  });
  await open(page, "#view=files");
  await page.getByRole("radio", { name: /^Imágenes/ }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole("radio", { name: /^Documentos/ }).click();
  const error = page.getByText(/quality-current-error/);
  await expect(error).toBeVisible();
  await pending?.fulfill({
    json: { ok: true, result: { items: [], counts: { image: 0, video: 0, audio: 0, document: 0 }, more: false } },
  });
  // A browser frame after the response lets React commit any stale update.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(error).toBeVisible();
});

test("A late page of files cannot append to a different filter", async ({ page }) => {
  let pending: Route | undefined;
  const file = (name: string) => ({
    media_id: name,
    kind: "document",
    mime: "text/plain",
    name,
    bytes: 4,
    path: `/quality/${name}`,
    thread_id: "quality-thread",
    thread_title: "Quality",
    message_id: name,
    author: { kind: "user" },
    created_at: "2026-01-01T00:00:00.000Z",
  });
  await page.route("**/rpc/media.shared", async (route) => {
    const { offset, kind } = route.request().postDataJSON();
    if (offset) {
      pending = route;
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        result: {
          items: [file(kind ? "current.txt" : "initial.txt")],
          counts: { image: 0, video: 0, audio: 0, document: 2 },
          more: !kind,
        },
      },
    });
  });
  await open(page, "#view=files");
  await expect(page.locator(".sharedf__card")).toContainText("initial.txt");
  await page.getByRole("button", { name: "Ver más", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole("radio", { name: /^Documentos/ }).click();
  await expect(page.locator(".sharedf__card")).toContainText("current.txt");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/rpc/media.shared") && r.request().postDataJSON().offset === 1,
  );
  await pending?.fulfill({
    json: {
      ok: true,
      result: { items: [file("stale.txt")], counts: { image: 0, video: 0, audio: 0, document: 2 }, more: false },
    },
  });
  await (await response).finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.locator(".sharedf__card")).toHaveCount(1);
  await expect(page.locator(".sharedf__card")).toContainText("current.txt");
});

for (const viewport of [
  { width: 650, height: 800 },
  { width: 750, height: 800 },
  { width: 844, height: 390 },
]) {
  test(`Chat stays inside the viewport at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const thread = await rpc<{ id: string }>("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Quality viewport",
    });
    await page.setViewportSize(viewport);
    await open(page, `#thread=${thread.id}${viewport.width === 750 ? "&panel=usage" : ""}`);
    const column =
      viewport.width === 750 ? page.getByRole("complementary", { name: "Panel lateral" }) : page.locator(".chatcol");
    await expect(column).toBeVisible();
    const bounds = await column.boundingBox();
    if (!bounds) throw new Error("The current column has no visible bounds");
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  });
}
