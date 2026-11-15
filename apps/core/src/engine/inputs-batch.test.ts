import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { pendingInput, say, scriptedLlm, startCore } from "./testkit.ts";

/** How long a turn waits for the owner here: long enough to tell a card that waited from one that did not. */
const WAIT_MS = 1500;

const widget = (name: string) => ({ name, title: name, html: "<i>x</i>" });

// One step of the model asks for several calls that each wait for the owner, as a super-agent creating a team does.
const llm = scriptedLlm(async (_req, { said, afterTool }) => {
  if (afterTool) return say("Turn done.");
  const again = /it will run without asking/.test(said) ? /name: (w-[\w-]+)/.exec(said)?.[1] : undefined;
  const names = again ? [again] : (/make the widgets ([\w, -]+)/.exec(said)?.[1]?.split(", ") ?? []);
  if (!names.length) return say("Hi.");
  return {
    message: {
      role: "assistant",
      content: null,
      tool_calls: names.map((n) => ({
        id: `c-${n}`,
        type: "function" as const,
        function: { name: "show_widget", arguments: JSON.stringify(widget(n)) },
      })),
    },
  };
});

let env: Awaited<ReturnType<typeof startCore>>;
let careful = "";
let project: TempDir;

before(async () => {
  env = await startCore({ llm, inputWaits: { turn: WAIT_MS, external: WAIT_MS } });
  project = tempDir("colonia-inputs-batch-");
  const root = project.path;
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "Northwind" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "careful.md"),
    "---\nname: Careful\nrole: tester\nautonomy: ask\n---\n\nYou check things.\n",
  );
  await env.client.call("projects.register", { path: root });
  const { agents } = await env.client.call("agents.list", {});
  careful = agents.find((x) => x.name === "Careful")?.id ?? "";
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await project.remove();
});

const newThread = () => env.client.call("threads.create", { kind: "agent", agent_id: careful });
const made = async (names: string[]) => {
  const { surfaces } = await env.client.call("surfaces.list", {});
  return names.filter((n) => surfaces.some((s) => s.name === n));
};
const pending = async (thread: string) =>
  (await env.client.call("runs.pending", { thread })).inputs.sort((a, b) => a.created_at.localeCompare(b.created_at));

test("approving each card as it shows runs every call of the step in the same turn", async () => {
  const names = ["w-q1", "w-q2", "w-q3", "w-q4", "w-q5", "w-q6"];
  const t = await newThread();
  await env.client.call("threads.send", { thread: t.id, text: `make the widgets ${names.join(", ")}` });
  for (const _ of names) {
    const input = await pendingInput(env.client, t.id);
    await env.client.call("runs.respond", { input: input.id, decision: "approve" });
  }
  const { runs } = await env.settle(t.id);
  assert.equal(runs.length, 1);
  assert.deepEqual(await made(names), names);
  assert.deepEqual(await pending(t.id), []);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "idle");
});

test("a card is answered from a client that connected after it was asked", async () => {
  const names = ["w-r1", "w-r2"];
  const t = await newThread();
  await env.client.call("threads.send", { thread: t.id, text: `make the widgets ${names.join(", ")}` });
  for (const _ of names) {
    await pendingInput(env.client, t.id);
    // The panel reloaded: a new client reads the chat and finds the card pending in it.
    const fresh = new ColoniaClient({ url: env.core.url });
    const { messages } = await fresh.call("threads.get", { thread: t.id });
    const cards = messages.flatMap((m) => m.parts.filter((p) => p.type === "input" && p.state === "pending"));
    assert.equal(cards.length, 1);
    const [card] = cards;
    assert.ok(card?.type === "input");
    await fresh.call("runs.respond", { input: card.input_id, decision: "approve" });
  }
  const { runs } = await env.settle(t.id);
  assert.equal(runs.length, 1);
  assert.deepEqual(await made(names), names);
});

test("once the owner lets a card go unanswered, the step's other cards open at once and the turn ends", async () => {
  const names = ["w-a1", "w-a2", "w-a3", "w-a4"];
  const t = await newThread();
  await env.client.call("threads.send", { thread: t.id, text: `make the widgets ${names.join(", ")}` });
  const { runs } = await env.settle(t.id, 10_000);
  assert.equal(runs.length, 1);
  const open = await pending(t.id);
  assert.equal(open.length, names.length);
  // The first card had its whole wait; the others did not each make the owner's absence last one more.
  const at = open.map((i) => Date.parse(i.created_at));
  assert.ok((at[1] ?? 0) - (at[0] ?? 0) >= WAIT_MS - 50, "the first card waits for the owner");
  assert.ok((at[3] ?? 0) - (at[1] ?? 0) < WAIT_MS / 2, `cards 2 to 4 opened ${(at[3] ?? 0) - (at[1] ?? 0)} ms apart`);
  assert.deepEqual(await made(names), []);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "input-required");

  // Back at the chat, the owner approves them all at once: each call runs once.
  await Promise.all(open.map((i) => env.client.call("runs.respond", { input: i.id, decision: "approve" })));
  await env.settle(t.id, 10_000);
  assert.deepEqual(await made(names), names);
  assert.deepEqual(await pending(t.id), []);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "idle");
});
