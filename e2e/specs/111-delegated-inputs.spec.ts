import type { Result } from "../../packages/protocol/src/methods.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a delegated command can be reviewed and denied in the initiating conversation", async ({ page }, info) => {
  await rpc("setup.finish", {});
  await rpc("agents.update", { agent: "scout", autonomy: "manual" });
  try {
    const coordinator = await rpc<{ id: string }>("agents.create", {
      slug: `permission-coordinator-${info.retry}-${info.repeatEachIndex}`,
      name: "Permission coordinator",
    });
    await rpc("agents.update", { agent: coordinator.id, autonomy: "manual" });
    const root = await rpc<{ id: string }>("threads.create", {
      kind: "loose",
      agent_id: coordinator.id,
      title: "Review a command",
    });
    await open(page, `#thread=${root.id}`);
    await rpc("threads.send", { thread: root.id, text: "delegate a command review" });
    const delegation = page.locator(".inputcard.is-pending").filter({ hasText: "usar delegate" });
    await delegation.getByRole("button", { name: "Aceptar una vez", exact: true }).click();
    const requests = page.getByRole("region", { name: "Tu equipo necesita tu respuesta" });
    await expect(requests).toContainText("Necesita tu OK");
    await expect(requests).toContainText("touch e2e-note.txt");
    await expect(requests.getByRole("button", { name: "Aceptar una vez", exact: true })).toBeVisible();
    const { inputs } = await rpc<Result<"runs.delegated_pending">>("runs.delegated_pending", { thread: root.id });
    expect(inputs[0]?.part.kind).toBe("confirm");
    const source = inputs[0]?.thread_id;
    expect(source).toBeDefined();
    await requests.getByRole("button", { name: "Rechazar", exact: true }).click();
    await expect(requests).toHaveCount(0);
    expect((await rpc<Result<"runs.pending">>("runs.pending", { thread: source })).inputs).toEqual([]);
    await open(page, `#thread=${source}`);
    await expect(page.locator(".inputline")).toContainText("Rechazado");
  } finally {
    await rpc("agents.update", { agent: "scout", autonomy: null });
  }
});

test("a delegated question is answered in the initiating chat and stays resolved after reload", async ({
  page,
}, info) => {
  await rpc("setup.finish", {});
  const root = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Coordinate the review",
  });
  await open(page, `#thread=${root.id}`);
  await rpc("threads.send", { thread: root.id, text: "delegate a review question" });
  const requests = page.getByRole("region", { name: "Tu equipo necesita tu respuesta" });
  await expect(requests).toBeVisible();
  await expect(requests).toContainText("Reviewer");
  await expect(requests).toContainText("Which days work");
  const pending = await rpc<Result<"runs.delegated_pending">>("runs.delegated_pending", { thread: root.id });
  const request = pending.inputs[0];
  expect(request).toBeDefined();
  await requests.scrollIntoViewIfNeeded();
  await expect(requests.getByRole("button", { name: "Enviar", exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("delegated-input-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await requests.scrollIntoViewIfNeeded();
  await expect(requests.getByRole("button", { name: "Abrir conversación" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("delegated-input-phone.png"), fullPage: true });
  await requests.getByRole("button", { name: "Monday", exact: true }).click();
  await requests.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(requests).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: /^Escríbele a/ })).toBeVisible();
  await expect(requests).toHaveCount(0);
  expect((await rpc<Result<"runs.pending">>("runs.pending", { thread: request?.thread_id })).inputs).toEqual([]);
  expect(page.url()).toContain(`thread=${root.id}`);
});
