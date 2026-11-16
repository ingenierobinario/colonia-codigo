import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Árbol: los chats sin leer van primero en su rama, aunque fueran a quedar bajo «Ver más»", async ({ page }) => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++)
    ids.push(
      (await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: `Arriba ${i}` })).id,
    );
  const old = ids[0] ?? "";
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // The oldest one is unread: by date it would sit under "N more".
    body.result.threads = body.result.threads.map((thread: { id: string }) => ({
      ...thread,
      unread: thread.id === old ? 2 : 0,
    }));
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  // BANDEJA-1 (2.30.0): no separate Unread block; the unread chat goes first inside its own branch, shown once.
  const branch = page.locator(".tree__agent").filter({ hasText: "Arriba 4" });
  await expect(branch.locator(".tree__session").first()).toContainText("Arriba 0");
  await expect(page.locator(".tree__session", { hasText: "Arriba 0" })).toHaveCount(1);
  await expect(page.locator(".tree__unreadlist")).toHaveCount(0);
  // Opening it reads it: from now on the core says so. It keeps its place while open, then goes back by date.
  await page.unroute("**/rpc/threads.list");
  await branch.locator(".tree__session", { hasText: "Arriba 0" }).click();
  // Loaded, the chat marks itself read.
  await expect(page.getByText(/^Chat con /)).toBeVisible();
  await expect(branch.locator(".tree__session").first()).toHaveClass(/is-selected/);
  await expect(branch.locator(".tree__session").first()).toContainText("Arriba 0");
  await branch.locator(".tree__session", { hasText: "Arriba 4" }).click();
  await expect(branch.locator(".tree__session", { hasText: "Arriba 0" })).toHaveCount(0);
});

test("Árbol: una sesión de Claude Code sin leer se muestra con su motor, no con el agente que la aloja", async ({
  page,
}) => {
  const { id } = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Revisión",
  });
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.threads = body.result.threads.map((thread: { id: string }) =>
      thread.id === id
        ? { ...thread, engine: "claude", kind: "code", cwd: "~/work/acme", unread: 1 }
        : { ...thread, unread: 0 },
    );
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const row = page.locator(".tree__session", { hasText: "Revisión" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".colonia-engine--claude")).toHaveCount(1);
  await expect(row.locator(".colonia-blob, .colonia-avatar")).toHaveCount(0);
  // The tree groups it under its engine's branch, which names Claude Code.
  await expect(page.locator(".tree__agent").filter({ has: row }).locator(".tree__agentname")).toHaveText("Claude Code");
});
