import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { z } from "zod";
import { knownProjects } from "../domain/project-links.ts";
import { parsePackage, renderPackage } from "../domain/project-package.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { folderAccess, rootsOf } from "../tools/folders.ts";

// The owner's message is the call to make: `{"name": "project_knowledge", "args": {...}}`.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (!said.startsWith("{")) return say("ok");
  const { name, args } = JSON.parse(said) as { name: string; args: object };
  return callTool("c1", name, args);
});

let env: Awaited<ReturnType<typeof startCore>>;
const dirs: Record<string, string> = {};
const ids: Record<string, string> = {};
before(async () => {
  env = await startCore({ llm });
  for (const name of ["acme", "northwind", "globex"]) {
    dirs[name] = tempDir(`${name}-`).path;
    fs.writeFileSync(
      path.join(dirs[name] as string, "AGENTS.md"),
      `# ${name}\n\nThe secret word of ${name} is ${name}-7.\n`,
    );
    fs.writeFileSync(path.join(dirs[name] as string, "prices.txt"), `prices of ${name}\n`);
    ids[name] = (await env.client.call("projects.register", { path: dirs[name] as string })).project.id;
    await env.client.call("projects.update", { project: ids[name] as string, name });
  }
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  for (const dir of Object.values(dirs)) await removeDir(dir);
});

const id = (name: string) => ids[name] as string;
const parsed = (text: string) => {
  const p = parsePackage(text);
  assert.ok(p.ok, JSON.stringify(p));
  return p.pkg;
};
const dir = (name: string) => dirs[name] as string;
const project = async (name: string) =>
  (await env.client.call("projects.list", {})).projects.find((p) => p.id === id(name));
const chat = async (name: string, text: string) => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: id(name) });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  return {
    thread: t,
    tools: JSON.stringify(call?.tools ?? []),
    prompt: (call?.messages ?? []).map((m) => String(m.content)).join("\n"),
    last: String(call?.messages.at(-1)?.content),
  };
};

test("a project saved before links existed loads as it was, and a broken value reads as no link", async () => {
  const before = await project("acme");
  assert.ok(before);
  assert.equal("parent" in before, false);
  assert.equal("knows" in before, false);
  assert.deepEqual(knownProjects(env.core.store, { project_id: id("acme") }), []);

  // What an older or damaged row could hold: never a failure to list projects.
  const db = new DatabaseSync(path.join(env.home, "colonia.db"));
  db.prepare("UPDATE projects SET knows = ?, parent = ? WHERE id = ?").run("{not json", null, id("acme"));
  assert.equal("knows" in ((await project("acme")) ?? {}), false);
  db.prepare("UPDATE projects SET knows = ? WHERE id = ?").run(
    JSON.stringify([id("northwind"), 7, id("northwind"), "gone"]),
    id("acme"),
  );
  assert.deepEqual((await project("acme"))?.knows, [id("northwind"), "gone"]);
  assert.deepEqual(
    knownProjects(env.core.store, { project_id: id("acme") }).map((p) => p.id),
    [id("northwind")],
    "a link to a project that is not there gives nothing",
  );
  db.prepare("UPDATE projects SET knows = NULL WHERE id = ?").run(id("acme"));
  db.close();

  // Without a link there is no tool and no word of the other projects.
  const alone = await chat("acme", "hello");
  assert.doesNotMatch(alone.tools, /project_knowledge/);
  assert.doesNotMatch(alone.prompt, /Projects you can read/);
  assert.doesNotMatch(alone.prompt, /northwind-7/);
});

test("links refuse loops, itself and unknown projects; a parent refuses a loop of parents", async () => {
  const set = (name: string, knows: string[]) => env.client.call("projects.update", { project: id(name), knows });
  assert.deepEqual((await set("acme", [id("northwind"), id("northwind")])).project.knows, [id("northwind")]);
  await assert.rejects(set("acme", [id("acme")]), /itself/);
  await assert.rejects(set("acme", ["nope"]), /no project/);
  await assert.rejects(set("northwind", [id("acme")]), /loop/);
  await set("northwind", [id("globex")]);
  await assert.rejects(set("globex", [id("acme")]), /loop/, "acme → northwind → globex → acme");
  assert.equal("knows" in ((await project("globex")) ?? {}), false, "a refused change writes nothing");

  const under = (name: string, parent: string | null) =>
    env.client.call("projects.update", { project: id(name), parent });
  assert.equal((await under("northwind", id("acme"))).project.parent, id("acme"));
  assert.equal((await under("globex", id("northwind"))).project.parent, id("northwind"));
  await assert.rejects(under("acme", id("globex")), /under this project/);
  await assert.rejects(under("acme", id("acme")), /itself/);
  // A parent groups in the sidebar and gives no reading: globex sits under northwind under acme.
  assert.deepEqual(
    knownProjects(env.core.store, { project_id: id("acme") }).map((p) => p.id),
    [id("northwind")],
  );
  assert.equal("parent" in (await under("globex", null)).project, false);
  // Another change leaves the links as they were.
  const marked = await env.client.call("projects.update", { project: id("acme"), autonomy: "manual" });
  assert.deepEqual(marked.project.knows, [id("northwind")]);
  await env.client.call("projects.update", { project: id("acme"), autonomy: null });
});

test("what a known project holds is read on demand, never changed, and goes one step only", async () => {
  const store = env.core.store;
  store.memories.add({
    scope: "project",
    project_id: id("northwind"),
    text: "Northwind bills on the 5th.",
    source: "owner",
  });
  store.memories.add({ scope: "project", project_id: id("globex"), text: "Globex bills on the 9th.", source: "owner" });
  await env.client.call("skills.save", {
    name: "northwind-quotes",
    target: "project",
    project: id("northwind"),
    content: "---\nname: northwind-quotes\ndescription: Writes Northwind quotes.\n---\n\nQuote in euros.\n",
  });

  // The turn names the project and nothing of what it holds.
  const first = await chat("acme", "hello");
  assert.match(first.tools, /project_knowledge/);
  assert.match(first.prompt, /Projects you can read, never change \(project_knowledge\): northwind/);
  assert.doesNotMatch(first.prompt, /northwind-7|bills on the 5th|Quote in euros/);
  assert.doesNotMatch(first.prompt, /globex/, "what northwind knows is not acme's");

  const ask = async (args: object) => (await chat("acme", JSON.stringify({ name: "project_knowledge", args }))).last;
  const list = await ask({});
  assert.match(list, /northwind/);
  assert.match(list, /instructions/);
  assert.match(list, /northwind-quotes/);
  assert.match(list, /memory/);
  assert.doesNotMatch(list, /globex/);
  assert.match(await ask({ project: "northwind", read: "instructions" }), /secret word of northwind is northwind-7/);
  assert.match(await ask({ project: id("northwind"), read: "memory" }), /bills on the 5th/);
  assert.match(await ask({ project: "Northwind", read: "skill", name: "northwind-quotes" }), /Quote in euros/);
  const refused = await ask({ project: "globex", read: "instructions" });
  assert.match(refused, /no project named globex/);
  assert.doesNotMatch(refused, /globex-7/);
  // Its own memory stays its own: nothing of northwind's was written into acme.
  assert.equal(store.memories.list({ scope: "project", project_id: id("acme"), pending: false, limit: 10 }).length, 0);

  // Files: read in every mode, written in none, and a project it does not know stays as closed as before.
  const base = { id: "t", agent_id: "superagent", project_id: id("acme"), kind: "loose" } as never;
  for (const reach of [undefined, "read", "all"] as const) {
    const thread = { ...(base as object), ...(reach ? { reach } : {}) } as never;
    const file = path.join(dir("northwind"), "prices.txt");
    assert.ok("at" in folderAccess(store, env.home, thread, file), `read with reach ${reach}`);
    const write = folderAccess(store, env.home, thread, file, { write: true });
    assert.ok("refused" in write, `never written with reach ${reach}`);
    assert.match("refused" in write ? write.refused : "", /read-only/);
  }
  const closed = folderAccess(store, env.home, base, path.join(dir("globex"), "prices.txt"));
  assert.ok("refused" in closed, "a project it does not know is outside");
  const roots = rootsOf(store, env.home, base);
  assert.equal(roots.find((r) => r.dir === dir("northwind"))?.write, false);
  assert.equal(
    roots.some((r) => r.dir === dir("globex")),
    false,
  );

  // The real tools say the same.
  const read = await chat(
    "acme",
    JSON.stringify({ name: "file_read", args: { path: path.join(dir("northwind"), "prices.txt") } }),
  );
  assert.match(read.last, /prices of northwind/);
  await chat(
    "acme",
    JSON.stringify({ name: "file_write", args: { path: path.join(dir("northwind"), "new.txt"), content: "x" } }),
  );
  assert.equal(fs.existsSync(path.join(dir("northwind"), "new.txt")), false);

  // Taken out of the list, the link gives nothing and breaks nothing; back in the list, it reads again.
  await env.client.call("projects.unregister", { project: id("northwind") });
  assert.deepEqual(knownProjects(store, { project_id: id("acme") }), []);
  assert.doesNotMatch((await chat("acme", "hello")).tools, /project_knowledge/);
  await env.client.call("projects.register", { path: dir("northwind") });
  assert.equal(knownProjects(store, { project_id: id("acme") }).length, 1);
});

test("a Flow reads the projects it was given, through the same link; an older Flow is as it was", async () => {
  const routine = await env.client.call("routines.set", {
    name: "Leads",
    project: id("globex"),
    agent: "superagent",
    schedule: { kind: "manual" },
    prompt: "Work",
  });
  const flow = {
    id: "leads",
    projectId: id("globex"),
    name: "Leads",
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "routine" as const, routine: routine.id },
  };
  const old = await env.client.call("flows.set", flow);
  assert.equal("knowledgeProjects" in old, false);
  const listed = (await env.client.call("flows.list", { project: id("globex") })).flows.find((f) => f.id === "leads");
  assert.equal("knowledgeProjects" in (listed ?? {}), false);

  await assert.rejects(env.client.call("flows.set", { ...flow, knowledgeProjects: ["nope"] }), /no project/);
  // Its own project is what it already has: it is not kept as a link.
  const given = await env.client.call("flows.set", { ...flow, knowledgeProjects: [id("globex"), id("acme")] });
  assert.deepEqual(given.knowledgeProjects, [id("acme")]);
  // Saved again by a client that knows nothing of the field, the list stays.
  assert.deepEqual((await env.client.call("flows.set", { ...flow, name: "Leads in" })).knowledgeProjects, [id("acme")]);

  const ctx = {
    transport: "internal" as const,
    role: "operator" as const,
    actor: "human" as const,
    session: undefined,
    log: createLog("test", true),
  };
  env.core.store.flows.save({ ...given, enabled: true });
  env.core.store.flows.receive("leads", "one", { message: "Work" });
  const made = await env.core.dispatch(
    "threads.create",
    { kind: "loose", agent_id: "superagent", project_id: id("globex") },
    { ...ctx, flowEvent: { flow: "leads", event: "one" } },
    "links-flow",
  );
  assert.equal(made.ok, true, JSON.stringify(made));
  const thread = (made as { result: { id: string } }).result;
  assert.deepEqual(
    knownProjects(env.core.store, { id: thread.id, project_id: id("globex") }).map((p) => p.id),
    [id("acme")],
  );
  const roots = rootsOf(env.core.store, env.home, env.core.store.threads.get(thread.id) as never);
  assert.equal(roots.find((r) => r.dir === dir("acme"))?.write, false);
  // Another chat of the same project, not started by the Flow, reads nothing more than its project does.
  assert.deepEqual(
    knownProjects(env.core.store, { id: (await chat("globex", "hello")).thread.id, project_id: id("globex") }),
    [],
  );

  assert.equal("knowledgeProjects" in (await env.client.call("flows.set", { ...flow, knowledgeProjects: [] })), false);
});

/**
 * The package reader of Colonia 2.36.26, as it shipped (domain/project-package.ts at 2de7f2d99): every object strict
 * but `organization`. A package this version writes must still pass it, or an older Colonia refuses the whole project.
 */
const Reader_2_36_26 = (() => {
  const Slug = z.string().regex(/^[a-z][a-z0-9_-]{0,80}$/);
  const Folder = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/);
  const RelPath = z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._ -]*(\/[A-Za-z0-9_][A-Za-z0-9._ -]*)*$/);
  const Connection = z
    .object({
      name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
      command: z.string().max(400).optional(),
      args: z.array(z.string().max(1000)).max(60).default([]),
      url: z.string().url().max(1000).optional(),
      needs: z
        .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,100}$/))
        .max(40)
        .default([]),
      headers: z
        .array(z.string().regex(/^[A-Za-z0-9-]{1,100}$/))
        .max(40)
        .default([]),
    })
    .strict();
  return z
    .object({
      format: z.literal("colonia-proyecto-1"),
      exported_at: z.string().max(40),
      project: z
        .object({
          name: z.string().trim().min(1).max(80),
          description: z.string().max(500).optional(),
          kind: z.enum(["personal", "app", "company", "software", "other"]).optional(),
        })
        .strict(),
      instructions: z.string().max(200_000),
      organization: z.object({ areas: z.array(z.unknown()).max(40), roles: z.array(z.unknown()).max(200) }).optional(),
      agents: z.array(z.object({ slug: Slug, text: z.string().max(200_000) }).strict()).max(200),
      skills: z
        .array(
          z
            .object({
              folder: Folder,
              files: z.array(z.object({ path: RelPath, text: z.string().max(200_000) }).strict()).max(60),
            })
            .strict(),
        )
        .max(100),
      connections: z.array(Connection).max(60),
    })
    .strict();
})();

test("a shared project carries the names of the projects it knows, never what they hold; importing links by name", async (t) => {
  const out = await env.client.call("projects.export", { project: id("acme") });
  const pkg = JSON.parse(out.content) as { knows?: string[]; organization?: { knows?: string[]; areas: unknown[] } };
  assert.deepEqual(pkg.organization?.knows, ["northwind"]);
  assert.equal("knows" in pkg, false, "never at the top: an older Colonia refuses a key it does not know there");
  assert.doesNotMatch(out.content, /northwind-7|bills on the 5th|Quote in euros|prices of northwind/);
  assert.equal(out.content.includes(dir("northwind")), false);
  // A project that knows none shares the package it always did: no new field, no empty team.
  const { project: empty } = await env.client.call("projects.create", { name: "Proyecto vacío" });
  t.after(async () => {
    await env.client.call("projects.unregister", { project: empty.id });
  });
  const plain = await env.client.call("projects.export", { project: empty.id });
  assert.equal("knows" in JSON.parse(plain.content), false);
  assert.equal("organization" in JSON.parse(plain.content), false);

  // The reader of 2.36.26 takes the package with links and drops them; with the names at the top it refused it all.
  const older = Reader_2_36_26.safeParse(JSON.parse(out.content));
  assert.equal(older.success, true, JSON.stringify(older.error?.issues));
  assert.equal("knows" in (older.data?.organization ?? {}), false);
  assert.equal(Reader_2_36_26.safeParse({ ...JSON.parse(plain.content), knows: ["northwind"] }).success, false);
  // The code and the link carry the same text.
  assert.equal(Reader_2_36_26.safeParse(JSON.parse(renderPackage(parsed(out.code)))).success, true);

  // Here there is a northwind: the copy knows it. A name nobody has here stays unresolved and breaks nothing.
  const importing = (knows: object, name: string) =>
    env.client.call("projects.import", {
      content: JSON.stringify({ ...JSON.parse(plain.content), ...knows }),
      name,
      save: true,
      replace: false,
    });
  const copy = await importing(
    { organization: { areas: [], roles: [], knows: ["Northwind", "Initech"] } },
    "Acme copy",
  );
  assert.deepEqual(copy.project?.knows, [id("northwind")]);
  assert.deepEqual(copy.unresolved, ["Initech"]);
  assert.equal(copy.organization, false, "links are not a team structure");
  // The names are not the team's: with no areas or roles no team file is written, and with them it holds no names.
  const folder = async (project: string | undefined) =>
    (await env.client.call("projects.list", {})).projects.find((p) => p.id === project)?.path ?? "";
  assert.equal(fs.existsSync(path.join(await folder(copy.project?.id), ".apc", "organization.json")), false);
  const team = await importing(
    { organization: { areas: [{ id: "sales", name: "Sales" }], roles: [], knows: ["northwind"] } },
    "Acme team",
  );
  assert.deepEqual(team.project?.knows, [id("northwind")]);
  const written = JSON.parse(
    fs.readFileSync(path.join(await folder(team.project?.id), ".apc", "organization.json"), "utf8"),
  );
  assert.deepEqual(written, { areas: [{ id: "sales", name: "Sales" }], roles: [] });
  // A package written by 2.36.27 carried the names at the top: it still links.
  const from27 = await importing({ knows: ["northwind", "Initech"] }, "Acme 27");
  assert.deepEqual(from27.project?.knows, [id("northwind")]);
  assert.deepEqual(from27.unresolved, ["Initech"]);
  // A package made before links existed imports as before.
  const old = await importing({}, "Globex copy");
  assert.equal("knows" in (old.project ?? {}), false);
  assert.equal("unresolved" in old, false);
  for (const made of [copy, team, from27, old]) {
    const at = await folder(made.project?.id);
    await env.client.call("projects.unregister", { project: made.project?.id ?? "" });
    if (at) await removeDir(at);
  }
});
