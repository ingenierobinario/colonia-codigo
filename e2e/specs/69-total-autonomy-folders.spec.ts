// An agent on total autonomy works in any folder, from a chat with no project too (DECISIONS.md#d-102).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

type Thread = {
  runs: Array<{ ended_at?: string }>;
  messages: Array<{ parts: Array<{ type: string; tool?: string; status?: string }> }>;
};

test("an agent on total autonomy writes in another folder from a chat with no project, with no card", async ({
  page,
}) => {
  // Este recorrido incluye Chromium, el turno del modelo y un proceso real del sistema.
  test.slow();
  await rpc("setup.finish", {});
  const northwind = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "colonia-e2e-anywhere-")));
  const note = path.join(northwind, "note.txt");
  const agent = `ondina-${randomUUID().slice(0, 8)}`;
  await rpc("agents.create", { slug: agent, name: "Ondina" });
  await rpc("agents.update", { agent, autonomy: "total" });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: agent, title: "Afuera" });
  try {
    await open(page, `#thread=${chat.id}`);
    await page.getByRole("textbox", { name: /Escríbele/ }).fill(`write a note at ${note}`);
    const sent = page.waitForResponse(
      (response) => response.url().endsWith("/rpc/threads.send") && response.request().method() === "POST",
    );
    await page.getByRole("textbox", { name: /Escríbele/ }).press("Enter");
    expect((await (await sent).json()).ok).toBe(true);

    const thread = () => rpc<Thread>("threads.get", { thread: chat.id });
    await expect
      .poll(async () => {
        const { runs } = await thread();
        return runs.length > 0 && runs.every((r) => Boolean(r.ended_at));
      })
      .toBe(true);
    await expect(page.locator(".inputcard.is-pending")).toHaveCount(0);
    expect(fs.readFileSync(note, "utf8")).toBe("note\n");
    const parts = (await thread()).messages.flatMap((m) => m.parts);
    expect(parts.some((p) => p.type === "tool" && p.tool === "shell" && p.status === "ok")).toBe(true);
  } finally {
    await rpc("agents.update", { agent, autonomy: null });
    fs.rmSync(northwind, { recursive: true, force: true });
  }
});
