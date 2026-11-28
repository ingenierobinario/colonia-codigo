import assert from "node:assert/strict";
import { test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import type { Store } from "../domain/store.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

function requestIn(store: Store, thread: string, waitMs = 60_000) {
  const run = store.runs.create({
    thread_id: thread,
    agent_id: "superagent",
    trigger: "a2a",
    state: "queued",
    input: { text: "Review", origin: { kind: "user" } },
    deadline_at: "2100-01-01T00:00:00.000Z",
  });
  return store.inputs.create({
    thread_id: thread,
    agent_id: "superagent",
    run_id: run.id,
    call_id: "review",
    kind: "confirm",
    prompt: "Review this change",
    waitMs,
  });
}

test("a delegated request reaches its initiating chat and both views answer the same input once", async () => {
  let reviewer = "";
  const llm = scriptedLlm((_req, { said, afterTool }) => {
    if (afterTool) return say("Review complete.");
    if (said.includes("coordinate-review"))
      return callTool("delegate-review", "delegate", { agent: reviewer, task: "choose-review-colour" });
    if (said.includes("choose-review-colour"))
      return callTool("review-colour", "ask_owner", { question: "Which colour should the reviewer use?" });
    return say("Ready.");
  });
  const env = await startCore({ llm });
  try {
    reviewer = (await env.client.call("agents.create", { slug: "reviewer", name: "Reviewer" })).id;
    const root = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: root.id, text: "coordinate-review" });
    const request = await waitFor(
      async () => (await env.client.call("runs.delegated_pending", { thread: root.id })).inputs[0],
      "the delegated request in its initiating chat",
    );
    assert.equal(request.agent_id, reviewer);
    assert.equal(request.agent_name, "Reviewer");
    assert.equal(request.part.prompt, "Which colour should the reviewer use?");
    const child = (await env.client.call("threads.get", { thread: request.thread_id })).thread;
    assert.equal(child.parent_id, root.id);
    assert.equal(child.kind, "a2a");
    assert.equal((await env.client.call("runs.pending", { thread: child.id })).inputs[0]?.id, request.part.input_id);
    const reconnected = new ColoniaClient({ url: env.core.url });
    assert.equal(
      (await reconnected.call("runs.delegated_pending", { thread: root.id })).inputs[0]?.part.input_id,
      request.part.input_id,
    );
    const answers = await Promise.allSettled([
      env.client.call("runs.respond", { input: request.part.input_id, text: "Blue" }),
      reconnected.call("runs.respond", { input: request.part.input_id, text: "Green" }),
    ]);
    assert.equal(answers.filter((answer) => answer.status === "fulfilled").length, 1);
    await env.settle(child.id);
    assert.deepEqual((await env.client.call("runs.delegated_pending", { thread: root.id })).inputs, []);
    assert.deepEqual((await env.client.call("runs.pending", { thread: child.id })).inputs, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("nested and archived requests survive the chat-list cap and cycles without including unrelated chats", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    const store = env.core.store;
    const root = store.threads.create({ kind: "loose", title: "Initiating chat", agent_ids: ["superagent"] });
    const child = store.threads.create({
      kind: "a2a",
      title: "Reviewer",
      agent_ids: ["superagent"],
      parent_id: root.id,
    });
    const nested = store.threads.create({
      kind: "a2a",
      title: "Nested review",
      agent_ids: ["superagent"],
      parent_id: child.id,
    });
    store.threads.arrange(child.id, { archived: true });
    store.threads.write(root.id, { parent_id: nested.id });
    const first = requestIn(store, child.id);
    const second = requestIn(store, nested.id);
    requestIn(store, root.id);
    requestIn(store, "home");
    requestIn(store, child.id, -1);
    const withdrawn = requestIn(store, child.id);
    store.inputs.settle(withdrawn.id, "withdrawn");
    for (let i = 0; i < 305; i++)
      store.threads.create({ kind: "loose", title: `Other chat ${i}`, agent_ids: ["superagent"] });
    const { inputs } = await env.client.call("runs.delegated_pending", { thread: root.id });
    assert.deepEqual(new Set(inputs.map((input) => input.part.input_id)), new Set([first.id, second.id]));
    assert.equal(inputs.length, 2);
    await assert.rejects(env.client.call("runs.delegated_pending", { thread: "missing-chat" }), /not found/);
    const model = new ColoniaClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(model.call("runs.delegated_pending", { thread: root.id }), /reserved to the owner/);
    const socket = await model.connect();
    try {
      await assert.rejects(socket.call("runs.delegated_pending", { thread: root.id }), /reserved to the owner/);
    } finally {
      socket.close();
    }
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the initiating chat receives the complete browser review without widening its approval scopes", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Ready")) });
  try {
    const store = env.core.store;
    const child = store.threads.create({
      kind: "a2a",
      title: "Browser review",
      agent_ids: ["superagent"],
      parent_id: "home",
    });
    const seed = requestIn(store, child.id);
    store.inputs.settle(seed.id, "withdrawn");
    const document = "return document.title;";
    const input = store.inputs.create({
      thread_id: child.id,
      agent_id: "superagent",
      run_id: seed.run_id,
      call_id: "browser-review",
      kind: "confirm",
      prompt: "Review this browser action",
      tool: "browser_evaluate",
      waitMs: 60_000,
      args: { document, path: "review.js", sha256: "review-hash", unrelated: "not part of the card" },
      approval: {
        key: "browser-review",
        server: "colonia",
        tool: "browser_evaluate",
        permanent: false,
        browser: {
          origin: "https://example.com",
          tab: "tab-review",
          epoch: "page-review",
          run: seed.run_id,
          title: "Example",
          tab_number: 2,
        },
      },
    });
    const [request] = (await env.client.call("runs.delegated_pending", { thread: "home" })).inputs;
    assert.deepEqual(request?.part.browser, {
      origin: "https://example.com",
      title: "Example",
      tab_number: 2,
      document,
      path: "review.js",
      sha256: "review-hash",
    });
    assert.deepEqual(request?.part.approval_scopes, ["once", "tab", "turn"]);
    assert.equal("args" in (request?.part ?? {}), false);
    await assert.rejects(
      env.client.call("runs.respond", { input: input.id, decision: "approve", scope: "always" }),
      /not available/,
    );
    await assert.rejects(env.client.call("runs.respond", { input: input.id, decision: "approve" }), /turn ended/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a persisted delegated request survives restart and never appears in another business", async () => {
  const llm = scriptedLlm(() => say("Ready"));
  const env = await startCore({ llm });
  let active = env;
  try {
    const store = env.core.store;
    const child = store.threads.create({
      kind: "a2a",
      title: "Saved review",
      agent_ids: ["superagent"],
      parent_id: "home",
    });
    const input = requestIn(store, child.id);
    const run = store.runs.get(input.run_id);
    assert.ok(run);
    store.runs.setState(run, "completed");
    await env.core.close();
    active = await startCore({ llm, home: env.home });
    const restored = await active.client.call("runs.delegated_pending", { thread: "home" });
    assert.equal(restored.inputs[0]?.part.input_id, input.id);
    const { workspace } = await active.client.call("workspaces.create", { name: "Separate business" });
    const other = new ColoniaClient({ url: `${active.core.url}/workspaces/${workspace.id}` });
    assert.deepEqual((await other.call("runs.delegated_pending", { thread: "home" })).inputs, []);
    await assert.rejects(other.call("runs.delegated_pending", { thread: child.id }), /not found/);
    assert.equal((await active.client.call("runs.delegated_pending", { thread: "home" })).inputs.length, 1);
  } finally {
    await active.core.close();
    await env.cleanup();
  }
});
