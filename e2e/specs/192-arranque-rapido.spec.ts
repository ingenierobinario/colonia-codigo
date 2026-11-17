import { expect, rpc, test } from "./kit.ts";

test("los chats aparecen mientras sigue pendiente comprobar el ordenador", async ({ page }) => {
  await rpc("setup.finish");
  await rpc("threads.create", { kind: "loose", agent_id: "superagent", title: "Chat disponible sin esperar" });
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  await page.route("**/rpc/environments.status", async (route) => {
    started.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto("/");
    await started.promise;
    await expect(page.getByText("Chat disponible sin esperar", { exact: true }).first()).toBeVisible();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});
