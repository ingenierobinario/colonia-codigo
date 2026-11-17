import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "colonia-org-")));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

const lastPrompt = async (thread: string) => {
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages[0]?.content);
};

test("the base project is named, described and typed by the owner", async () => {
  assert.deepEqual((await env.client.call("projects.list", {})).base, { name: "Default" });
  const r = await env.client.call("projects.update_base", { name: "Acme", description: "Our shop", kind: "company" });
  assert.deepEqual(r.base, { name: "Acme", description: "Our shop", kind: "company" });
  const cleared = await env.client.call("projects.update_base", { description: null });
  assert.deepEqual(cleared.base, { name: "Acme", kind: "company" });
});

test("a project's areas and roles live in .apc/organization.json, v1's format read as it is", async () => {
  const file = path.join(repo, ".apc", "organization.json");
  // v1 wrote nulls for what is missing, and a hand edit may break one entry.
  fs.writeFileSync(
    file,
    JSON.stringify({
      areas: [
        { slug: "finance", name: "Finanzas", goal: null },
        { slug: "Bad Slug", name: "x" },
      ],
      roles: [{ slug: "cfo", name: "Chief Financial Officer", area: "finance", description: null }],
    }),
  );
  assert.deepEqual(await env.client.call("org.get", { project }), {
    areas: [{ slug: "finance", name: "Finanzas" }],
    roles: [{ slug: "cfo", name: "Chief Financial Officer", area: "finance" }],
  });
  // A role whose area is gone stays, as a general role.
  const saved = await env.client.call("org.set", {
    project,
    organization: {
      areas: [{ slug: "growth", name: "Crecimiento", goal: "More customers" }],
      roles: [
        { slug: "cfo", name: "Chief Financial Officer", area: "finance" },
        { slug: "cmo", name: "Chief Marketing Officer", area: "growth" },
      ],
    },
  });
  assert.deepEqual(saved.roles, [
    { slug: "cfo", name: "Chief Financial Officer" },
    { slug: "cmo", name: "Chief Marketing Officer", area: "growth" },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), saved);

  // The project's agents read its kind and its areas and roles.
  await env.client.call("projects.update", { project, kind: "company" });
  const t = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    project_id: project,
    title: "org",
  });
  const prompt = await lastPrompt(t.id);
  assert.match(prompt, /It is a company project\./);
  assert.match(
    prompt,
    /- Area Crecimiento: More customers\n- Role Chief Financial Officer\n- Role Chief Marketing Officer \(Crecimiento\)/,
  );
});

test("the base project's areas and roles are kept by Colonia and reach the chats outside any project", async () => {
  await env.client.call("org.set", {
    organization: {
      areas: [{ slug: "direction", name: "Dirección" }],
      roles: [{ slug: "ceo", name: "CEO", area: "direction" }],
    },
  });
  assert.equal((await env.client.call("org.get", {})).roles[0]?.name, "CEO");
  const prompt = await lastPrompt("home");
  assert.match(prompt, /## Project: Acme\nIt is a company project\./);
  assert.match(prompt, /- Role CEO \(Dirección\)/);
});

test("an organization.json saved with a BOM is read as written", async () => {
  fs.writeFileSync(
    path.join(repo, ".apc", "organization.json"),
    `\uFEFF${JSON.stringify({ areas: [{ slug: "sales", name: "Ventas" }], roles: [] })}`,
  );
  assert.deepEqual((await env.client.call("org.get", { project })).areas, [{ slug: "sales", name: "Ventas" }]);
});

test("la asignación comprueba proyecto, área y rol antes de guardar en el archivo del agente", async () => {
  const { project: empresa } = await env.client.call("projects.create", { name: "Prueba de áreas", kind: "company" });
  const agent = await env.client.call("agents.create", {
    project_id: empresa.id,
    name: "Ana",
    slug: "ana",
    role: "Perfil anterior",
    prompt: "Instrucciones originales",
  });
  const other = await env.client.call("agents.create", { name: "Luz", slug: "luz", role: "", prompt: "" });
  await env.client.call("org.set", {
    project: empresa.id,
    organization: {
      areas: [
        { slug: "ventas", name: "Ventas" },
        { slug: "compras", name: "Compras" },
      ],
      roles: [
        { slug: "negociar", name: "Negociación", area: "ventas" },
        { slug: "apoyo", name: "Apoyo" },
      ],
    },
  });
  const assign = { project: empresa.id, agent: agent.id, area: "ventas", role: "negociar" };
  for (const params of [
    { ...assign, agent: other.id },
    { ...assign, project: undefined },
    { ...assign, area: "externa" },
    { ...assign, role: "externo" },
    { ...assign, area: "compras" },
  ])
    await assert.rejects(env.client.call("org.assign", params));
  assert.equal((await env.client.call("agents.get", { agent: agent.id })).agent.role, "Perfil anterior");
  // Un rol personalizado que ya tenía el agente se conserva al cambiar solamente de área.
  await env.client.call("org.assign", { project: empresa.id, agent: agent.id, area: "compras" });
  assert.equal((await env.client.call("agents.get", { agent: agent.id })).agent.role, "Perfil anterior");
  const saved = await env.client.call("org.assign", assign);
  assert.deepEqual([saved.area, saved.role], ["ventas", "Negociación"]);
  assert.ok(empresa.path);
  assert.match(fs.readFileSync(path.join(empresa.path, ".apc", "agents", "ana.md"), "utf8"), /Negociación/);
  // Un rol de área tampoco puede quedar en otra área omitiendo el rol.
  await assert.rejects(env.client.call("org.assign", { project: empresa.id, agent: agent.id, area: "compras" }));
  const general = await env.client.call("org.assign", { ...assign, area: null, role: "apoyo" });
  assert.deepEqual([general.area, general.role], [undefined, "Apoyo"]);
  const cleared = await env.client.call("org.assign", { ...assign, area: null, role: null });
  assert.deepEqual([cleared.area, cleared.role], [undefined, ""]);
  assert.equal((await env.client.call("agents.get", { agent: agent.id })).prompt.trim(), "Instrucciones originales");
  await env.client.call("agents.archive", { agent: agent.id });
  await assert.rejects(env.client.call("org.assign", assign));
});

test("el proyecto base solamente asigna sus propios agentes", async () => {
  await env.client.call("projects.update_base", { kind: "company" });
  await env.client.call("org.set", { organization: { areas: [{ slug: "gestion", name: "Gestión" }], roles: [] } });
  const next = await env.client.call("org.assign", { agent: "scout", area: "gestion", role: null });
  assert.equal(next.area, "gestion");
  await env.client.call("projects.update_base", { kind: "software" });
  await assert.rejects(env.client.call("org.assign", { agent: "scout", area: "gestion", role: null }));
});
