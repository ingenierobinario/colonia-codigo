import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

test("el enlace de Rutinas muestra el proyecto antes de welcome y recupera los cambios ocurridos antes de suscribir", async ({
  page,
}) => {
  await rpc("setup.finish");
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Proyecto de arranque directo" });
  const renamed = "Proyecto renombrado durante el arranque";
  const releaseAgents = Promise.withResolvers<void>();
  const releaseSocket = Promise.withResolvers<void>();
  const serverReady = Promise.withResolvers<void>();
  const missedChange = Promise.withResolvers<void>();
  let subscribed = false;
  let renaming = false;
  let calls = 0;
  let projectChatReads = 0;
  try {
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/rpc/threads.list" && request.postDataJSON()?.project_id === project.id)
        projectChatReads++;
    });
    await page.route("**/rpc/projects.list", async (route) => {
      calls++;
      await route.continue();
    });
    await page.route("**/rpc/agents.list", async (route) => {
      await releaseAgents.promise;
      await route.continue();
    });
    await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
      const server = socket.connectToServer();
      server.onMessage(async (raw) => {
        const frame = JSON.parse(String(raw));
        if (renaming && !subscribed && frame.t === "event" && frame.payload?.type === "team.updated") {
          missedChange.resolve();
          return;
        }
        if (frame.t === "welcome") {
          serverReady.resolve();
          await releaseSocket.promise;
          subscribed = true;
        }
        if (subscribed) socket.send(raw);
      });
    });
    await page.goto(`/#project=${project.id}&tab=routines`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: project.name, exact: true })).toBeVisible();
    expect(subscribed).toBe(false);
    expect(calls).toBe(1);
    await serverReady.promise;
    renaming = true;
    await rpc("projects.update", { project: project.id, name: renamed });
    await missedChange.promise;
    releaseSocket.resolve();
    await expect(page.getByRole("region", { name: renamed, exact: true })).toBeVisible();
    expect(calls).toBe(2);
    expect(projectChatReads).toBe(0);
    releaseAgents.resolve();
    await expect.poll(() => projectChatReads).toBe(1);
  } finally {
    releaseSocket.resolve();
    releaseAgents.resolve();
    await rpc("projects.unregister", { project: project.id });
  }
});
