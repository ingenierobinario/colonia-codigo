import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FlowGraph } from "@colonia/protocol/flow-graph";
import { knownProjects } from "../domain/project-links.ts";
import { callTool, computerChat, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import type { LlmRequest } from "../providers/llm.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { folderAccess } from "../tools/folders.ts";

// Who reads the projects a project knows, beyond an agent in a plain chat (DECISIONS.md#d-191): a Flow's bot, the
// chats a Flow's chat hands work to, and a chat on the shared computer.

type Env = Awaited<ReturnType<typeof startCore>>;
const toolNames = (req: LlmRequest | undefined) => (req?.tools ?? []).map((t) => t.function.name);
const text = (req: LlmRequest | undefined) => (req?.messages ?? []).map((m) => String(m.content)).join("\n");
const LINE = /Projects you can read, never change \(project_knowledge\): acme/;

/** Two projects in folders: `acme` holds a secret word, `globex` is where the work happens. */
async function twoProjects(env: Env) {
  const dirs: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const name of ["acme", "globex"]) {
    const dir = tempDir(`${name}-`).path;
    fs.writeFileSync(path.join(dir, "AGENTS.md"), `# ${name}\n\nThe secret word of ${name} is ${name}-7.\n`);
    dirs[name] = dir;
    ids[name] = (await env.client.call("projects.register", { path: dir })).project.id;
    await env.client.call("projects.update", { project: ids[name] as string, name });
  }
  return {
    acme: ids.acme as string,
    globex: ids.globex as string,
    acmeDir: dirs.acme as string,
    clean: async () => {
      for (const dir of Object.values(dirs)) await removeDir(dir);
    },
  };
}

test("a bot of a Flow step reads the projects its Flow was given: the tool and the folders, both", async () => {
  // The bot asks for the instructions of acme, then answers with what it read.
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("k1", "project_knowledge", { project: "acme", read: "instructions" }),
  );
  const env = await startCore({ llm });
  const p = await twoProjects(env);
  try {
    const flow = {
      id: "triage",
      projectId: p.globex,
      name: "Triage",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
      knowledgeProjects: [p.acme],
    };
    await env.client.call("flows.set", flow);
    const graph: FlowGraph = {
      schemaVersion: 2,
      nodes: [
        { kind: "webhook", id: "start", label: "Webhook" },
        {
          id: "ask",
          kind: "agent",
          label: "Ask",
          prompt: "Sort this request.",
          input: { kind: "event", path: [] },
          bot: { name: "Triage", system: "Label each request." },
        },
      ],
      edges: [{ source: "start", target: "ask" }],
      layout: [],
    };
    const draft = await env.client.call("flows.draft_save", { flow: "triage", expectedVersion: null, graph });
    await env.client.call("flows.publish", {
      flow: "triage",
      expectedDraftVersion: draft.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    const saved = env.core.store.flows.get("triage");
    assert.ok(saved);
    assert.deepEqual(saved.knowledgeProjects, [p.acme], "publishing keeps the Flow's projects");
    await env.client.call("flows.set", { ...saved, enabled: true });
    const { event } = await env.client.call("flows.run_now", { flow: "triage", data: { text: "A lamp broke" } });
    await waitFor(
      () => env.core.store.flows.events("triage", 10).find((e) => e.event_id === event && e.state !== "pending"),
      "the run to end",
    );
    const step = env.core.store.flowGraphRuns.detail("triage", event)?.steps.find((s) => s.node === "ask");
    assert.ok(step?.thread_id, "the step has its chat");
    assert.equal(step.state, "succeeded", step.output ?? "");
    assert.equal(env.core.store.threads.context(step.thread_id).flow_step?.bot, true);

    const first = llm.calls[0];
    assert.ok(String(first?.messages[0]?.content).startsWith("You are Triage, a bot"), "it is the bot speaking");
    assert.ok(toolNames(first).includes("project_knowledge"), `the bot has the tool: ${toolNames(first).join(",")}`);
    assert.ok(toolNames(first).includes("file_read"), "and its file tools");
    assert.match(text(first), LINE);
    assert.doesNotMatch(text(first), /acme-7/, "nothing of acme is in the prompt until it asks");
    assert.match(JSON.parse(step.output ?? "{}").text, /secret word of acme is acme-7/);
    // The folder too, read-only: asked for, the tool says where the files are.
    const thread = env.core.store.threads.get(step.thread_id) as never;
    assert.ok("at" in folderAccess(env.core.store, env.home, thread, path.join(p.acmeDir, "AGENTS.md")));
    assert.ok(
      "refused" in folderAccess(env.core.store, env.home, thread, path.join(p.acmeDir, "x.txt"), { write: true }),
    );
    // What the bot is still kept from (DECISIONS.md#d-172) stays out.
    for (const name of ["recall", "remember", "delegate", "read_chat"])
      assert.ok(!toolNames(first).includes(name), `${name} stays out`);
  } finally {
    await env.core.close();
    await env.cleanup();
    await p.clean();
  }
});

test("a chat a Flow's chat hands work to reads the Flow's projects too, at any depth", async () => {
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content).slice(0, 400));
    if (said.includes("Hand it down"))
      return callTool("d1", "delegate", { agent: "scout", task: "Check the word of acme.", wait_s: 20 });
    if (said.includes("Check the word of acme"))
      return callTool("k1", "project_knowledge", { project: "acme", read: "instructions" });
    return say("ok");
  });
  const env = await startCore({ llm });
  const p = await twoProjects(env);
  try {
    const store = env.core.store;
    const routine = await env.client.call("routines.set", {
      name: "Leads",
      project: p.globex,
      agent: "superagent",
      schedule: { kind: "manual" },
      prompt: "Work",
    });
    const flow = await env.client.call("flows.set", {
      id: "leads",
      projectId: p.globex,
      name: "Leads",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "routine" as const, routine: routine.id },
      knowledgeProjects: [p.acme],
    });
    assert.deepEqual(flow.knowledgeProjects, [p.acme]);
    // Enabled in the store only, so the event waits for this test instead of the Flow runner.
    store.flows.save({ ...flow, enabled: true });
    store.flows.receive("leads", "one", { message: "Work" });
    const made = await env.core.dispatch(
      "threads.create",
      { kind: "loose", agent_id: "superagent", project_id: p.globex },
      {
        transport: "internal" as const,
        role: "operator" as const,
        actor: "human" as const,
        session: undefined,
        log: createLog("test", true),
        flowEvent: { flow: "leads", event: "one" },
      },
      "reach-flow",
    );
    assert.equal(made.ok, true, JSON.stringify(made));
    const chat = (made as { result: { id: string } }).result.id;
    await env.client.call("threads.send", { thread: chat, text: "Hand it down" });
    await env.settle(chat);

    const child = store.threads.sessions(chat)[0];
    assert.ok(child, "the delegation opened its chat");
    assert.equal(store.threads.context(child.id).flow_knows, undefined, "nothing is copied into it");
    assert.deepEqual(
      knownProjects(store, child).map((k) => k.id),
      [p.acme],
    );
    // Its own turn had the tool and the line, and read acme with it.
    assert.ok(
      llm.calls.some((c) =>
        c.messages.some((m) => m.role === "tool" && /secret word of acme is acme-7/.test(String(m.content))),
      ),
      "the worker read acme's instructions through project_knowledge",
    );
    const worker = llm.calls.find((c) => c.messages.some((m) => m.role === "tool" && /acme-7/.test(String(m.content))));
    assert.ok(toolNames(worker).includes("project_knowledge"));
    assert.match(text(worker), LINE);

    // Deeper, and in another project: the nearest chat above that a Flow started decides.
    const deeper = store.threads.create({
      kind: "a2a",
      title: "deeper",
      agent_ids: ["scout"],
      parent_id: child.id,
      project_id: p.globex,
    });
    assert.deepEqual(
      knownProjects(store, deeper).map((k) => k.id),
      [p.acme],
    );
    const inAcme = store.threads.create({
      kind: "a2a",
      title: "in acme",
      agent_ids: ["scout"],
      parent_id: chat,
      project_id: p.acme,
    });
    assert.deepEqual(knownProjects(store, inAcme), [], "its own project is never a link");
    // A chat nobody handed down from a Flow reads only what its project knows.
    const plain = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: p.globex,
    });
    const under = store.threads.create({
      kind: "a2a",
      title: "under plain",
      agent_ids: ["scout"],
      parent_id: plain.id,
      project_id: p.globex,
    });
    assert.deepEqual(knownProjects(store, under), []);
    // The Flow's list is read live from the chat above: taken away there, the worker loses it.
    store.threads.mergeContext(chat, { flow_knows: [] });
    assert.deepEqual(knownProjects(store, child), []);
  } finally {
    await env.core.close();
    await env.cleanup();
    await p.clean();
  }
});

test("a chat on the shared computer reads the known projects through the tool, and is never told their folders", async () => {
  const home = tempDir("colonia-vm-known-").path;
  const offered: string[][] = [];
  const llm = scriptedLlm((req, { said, afterTool }) => {
    offered.push(toolNames(req));
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said.startsWith("{")) return callTool("k1", "project_knowledge", JSON.parse(said) as object);
    return say("ok");
  });
  const env = await startCore({ home, llm, computer: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  const p = await twoProjects(env);
  try {
    await env.client.call("projects.update", { project: p.globex, knows: [p.acme] });
    await env.client.call("environments.permit", { agent: "superagent", on: true });
    const ask = async (thread: string, said: string) => {
      await env.client.call("threads.send", { thread, text: said });
      await env.settle(thread);
      return llm.calls.at(-1);
    };
    const open = async () =>
      (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: p.globex })).id;

    const vm = await open();
    await env.client.call("environments.bind", { thread: vm });
    offered.length = 0;
    const hello = await ask(vm, "hello");
    assert.ok(offered[0]?.includes("project_knowledge"), String(offered[0]));
    assert.ok(offered[0]?.includes("shell"), "it works on the computer");
    assert.ok(!offered[0]?.includes("file_read"), "the Mac's file tools stay out");
    assert.match(text(hello), LINE);
    assert.match(text(hello), /shared Linux computer/);
    assert.equal(text(hello).includes(p.acmeDir), false, "no path of the Mac in its prompt");
    const list = String((await ask(vm, "{}"))?.messages.at(-1)?.content);
    assert.match(list, /acme/);
    assert.match(list, /instructions/);
    assert.doesNotMatch(list, /Files, read-only/);
    assert.equal(list.includes(p.acmeDir), false, "no path of the Mac in what the tool says");
    assert.match(
      String((await ask(vm, JSON.stringify({ project: "acme", read: "instructions" })))?.messages.at(-1)?.content),
      /secret word of acme is acme-7/,
    );
    const one = String((await ask(vm, JSON.stringify({ project: "acme" })))?.messages.at(-1)?.content);
    assert.equal(one.includes(p.acmeDir), false);

    // The same project in a chat on the Mac is told where the files are.
    const mac = await open();
    const there = String((await ask(mac, "{}"))?.messages.at(-1)?.content);
    assert.match(there, /Files, read-only/);
    assert.ok(there.includes(p.acmeDir));
    // A chat on the computer whose project knows none is as it was: no tool, no line.
    const none = await computerChat(env);
    await env.client.call("environments.bind", { thread: none });
    offered.length = 0;
    const alone = await ask(none, "hello");
    assert.ok(!offered[0]?.includes("project_knowledge"));
    assert.doesNotMatch(text(alone), /Projects you can read/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await p.clean();
  }
});
