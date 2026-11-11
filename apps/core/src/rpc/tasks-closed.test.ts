import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "@colonia/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import type { CallContext } from "./context.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const agentContext = (thread: string): CallContext => ({
  role: "operator",
  actor: "agent",
  transport: "internal",
  session: undefined,
  log: createLog("test", true),
  agent: { id: "superagent", thread_id: thread, run_id: "run_test" },
});

async function withCore(run: (env: Env) => Promise<void>) {
  const env = await startCore({ llm: scriptedLlm(() => say("Done.")) });
  try {
    await run(env);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
}

/** A task closed at a given minute, so the order under test does not hang on the wall clock. */
async function closedAt(
  env: Env,
  t: { mock: { timers: { setTime(ms: number): void } } },
  minute: number,
  fields: { title: string; description?: string; project?: string; state?: "done" | "dropped" },
): Promise<Task> {
  const { state = "done", ...create } = fields;
  const task = await env.client.call("tasks.create", create);
  t.mock.timers.setTime(Date.UTC(2030, 0, 1, 0, minute));
  return env.client.call("tasks.close", { task: task.id, state });
}

const titles = (r: { tasks: Task[] }) => r.tasks.map((x) => x.title);

test("closed tasks come a page at a time, done and dropped together, newest activity first", async (t) => {
  await withCore(async (env) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
    for (let i = 1; i <= 5; i++) await closedAt(env, t, i, { title: `Report ${i}`, state: i % 2 ? "done" : "dropped" });
    await env.client.call("tasks.create", { title: "Still open" });

    const first = await env.client.call("tasks.closed", { limit: 2 });
    assert.deepEqual(titles(first), ["Report 5", "Report 4"]);
    assert.deepEqual(
      first.tasks.map((x) => x.state),
      ["done", "dropped"],
    );
    assert.equal(first.total, 5);
    const second = await env.client.call("tasks.closed", { limit: 2, offset: 2 });
    assert.deepEqual(titles(second), ["Report 3", "Report 2"]);
    const last = await env.client.call("tasks.closed", { limit: 2, offset: 4 });
    assert.deepEqual(titles(last), ["Report 1"]);
    assert.equal(last.total, 5);
    const past = await env.client.call("tasks.closed", { limit: 2, offset: 6 });
    assert.deepEqual(past, { tasks: [], total: 5 });
    // The default page holds them all here, and never an open task.
    assert.equal((await env.client.call("tasks.closed", {})).tasks.length, 5);
  });
});

test("nothing closed gives an empty page and a total of zero", async () => {
  await withCore(async (env) => {
    await env.client.call("tasks.create", { title: "Still open" });
    assert.deepEqual(await env.client.call("tasks.closed", {}), { tasks: [], total: 0 });
    assert.deepEqual(await env.client.call("tasks.closed", { query: "open" }), { tasks: [], total: 0 });
  });
});

test("the search ignores case and accents, wants every word, and counts its matches", async (t) => {
  await withCore(async (env) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
    await closedAt(env, t, 1, { title: "Diseño del catálogo", description: "Portada y ÍNDICE" });
    await closedAt(env, t, 2, { title: "Catalogo de precios", state: "dropped" });
    await closedAt(env, t, 3, { title: "Revisar contrato", description: "Sin relación" });

    const one = await env.client.call("tasks.closed", { query: "  DISENO catalogo " });
    assert.deepEqual(titles(one), ["Diseño del catálogo"]);
    assert.equal(one.total, 1);
    const both = await env.client.call("tasks.closed", { query: "catálogo" });
    assert.deepEqual(titles(both), ["Catalogo de precios", "Diseño del catálogo"]);
    // The description counts too; the total is the matches, not the page.
    assert.deepEqual(titles(await env.client.call("tasks.closed", { query: "indice" })), ["Diseño del catálogo"]);
    const paged = await env.client.call("tasks.closed", { query: "catalogo", limit: 1, offset: 1 });
    assert.deepEqual(titles(paged), ["Diseño del catálogo"]);
    assert.equal(paged.total, 2);
    assert.deepEqual(await env.client.call("tasks.closed", { query: "catalogo contrato" }), { tasks: [], total: 0 });
    // A blank query is no query.
    assert.equal((await env.client.call("tasks.closed", { query: "   " })).total, 3);
  });
});

test("closed tasks narrow to a project, to the ones outside every project, and to a kind", async (t) => {
  await withCore(async (env) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
    const { project } = await env.client.call("projects.create", { name: "Launch" });
    await closedAt(env, t, 1, { title: "In the project", project: project.id });
    await closedAt(env, t, 2, { title: "Outside" });

    assert.deepEqual(titles(await env.client.call("tasks.closed", { project: project.id })), ["In the project"]);
    assert.deepEqual(titles(await env.client.call("tasks.closed", { unfiled: true })), ["Outside"]);
    assert.equal((await env.client.call("tasks.closed", {})).total, 2);
    assert.equal((await env.client.call("tasks.closed", { kind: "task" })).total, 2);
    assert.deepEqual(await env.client.call("tasks.closed", { kind: "commitment" }), { tasks: [], total: 0 });
  });
});

test("an agent sees the closed tasks of its own project and the global ones, never another project's", async (t) => {
  await withCore(async (env) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1) });
    const mine = (await env.client.call("projects.create", { name: "Mine" })).project;
    const other = (await env.client.call("projects.create", { name: "Other" })).project;
    await closedAt(env, t, 1, { title: "Mine closed", project: mine.id });
    await closedAt(env, t, 2, { title: "Other closed", project: other.id });
    await closedAt(env, t, 3, { title: "Global closed" });
    const thread = env.core.store.threads.create({
      kind: "loose",
      title: "Work",
      agent_ids: ["superagent"],
      project_id: mine.id,
    });

    for (const params of [{}, { project: other.id }, { query: "closed" }, { query: "other" }]) {
      const r = await env.core.dispatch(
        "tasks.closed",
        params,
        agentContext(thread.id),
        `scope-${JSON.stringify(params)}`,
      );
      assert.ok(r.ok, JSON.stringify(params));
      if (!r.ok) return;
      const seen = titles(r.result as { tasks: Task[] });
      assert.ok(!seen.includes("Other closed"), JSON.stringify(params));
      if (!("query" in params) || params.query === "closed") assert.deepEqual(seen, ["Global closed", "Mine closed"]);
      else assert.deepEqual(r.result, { tasks: [], total: 0 });
    }
    // The owner sees the three.
    assert.equal((await env.client.call("tasks.closed", {})).total, 3);
  });
});

test("reopening into a column is one change that keeps the conversation and the history", async () => {
  await withCore(async (env) => {
    const task = await env.client.call("tasks.create", { title: "Send the offer", status: "doing" });
    await env.client.call("tasks.comment", { task: task.id, text: "Waiting for the price list." });
    const closed = await env.client.call("tasks.close", { task: task.id, state: "done" });
    const before = await env.client.call("tasks.get", { task: task.id });

    const reopened = await env.client.call("tasks.close", { task: task.id, state: "open", status: "todo" });
    assert.equal(reopened.state, "open");
    assert.equal(reopened.status, "todo");
    assert.equal(reopened.thread_id, closed.thread_id);
    const after = await env.client.call("tasks.get", { task: task.id });
    assert.deepEqual(after.events.slice(0, before.events.length), before.events);
    assert.deepEqual(
      after.events.slice(before.events.length).map((e) => e.op),
      ["reopen"],
    );
    assert.deepEqual(
      after.comments.map((m) => m.id),
      before.comments.map((m) => m.id),
    );
    assert.deepEqual(await env.client.call("tasks.closed", {}), { tasks: [], total: 0 });
  });
});

test("a reopen column is refused when it is unknown, when the task closes, and with rework", async () => {
  await withCore(async (env) => {
    const task = await env.client.call("tasks.create", { title: "Send the offer" });
    await env.client.call("tasks.close", { task: task.id, state: "done" });
    await assert.rejects(env.client.call("tasks.close", { task: task.id, state: "open", status: "nowhere" }));
    await assert.rejects(env.client.call("tasks.close", { task: task.id, state: "dropped", status: "todo" }));
    await assert.rejects(
      env.client.call("tasks.close", { task: task.id, state: "open", status: "todo", rework: true, note: "Again." }),
    );
    assert.equal((await env.client.call("tasks.get", { task: task.id })).task.state, "done");
  });
});
