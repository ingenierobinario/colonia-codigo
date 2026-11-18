import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FlowDraftGraph } from "@colonia/protocol/flow-graph";
import { parsePackage } from "../domain/project-package.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { sharedProjectRoutes } from "../public-routes.ts";

test("los Flows de un proyecto viajan como borradores apagados, con agentes propios y sin datos ni destinos activos", async () => {
  const llm = scriptedLlm(() => say("prueba"));
  const a = await startCore({ llm });
  const b = await startCore({ llm });
  try {
    const source = (await a.client.call("projects.create", { name: "Equipo origen" })).project;
    const other = (await a.client.call("projects.create", { name: "Equipo distinto" })).project;
    const agentsDir = path.join(source.path ?? "", ".apc", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "lector.md"), "---\nname: Lector\nrole: Revisor\n---\nResume la entrada.");
    await a.client.call("projects.sync", { project: source.id });
    const agent = a.core.store.agents.list().find((v) => v.project_id === source.id && v.slug === "lector");
    assert.ok(agent);
    const definition = {
      id: "identidad-original",
      name: "Revisar",
      enabled: true,
      projectId: source.id,
      path: "ruta-privada",
      tableKey: "actual",
      readKeys: ["anterior"],
      predicates: [{ path: ["validado"], equals: true }],
      action: { kind: "agent" as const, agent: agent.id, prompt: "Revisa la entrada" },
      knowledgeProjects: [other.id],
    };
    const store = a.core.store;
    store.flows.save(definition);
    store.flows.save({ ...definition, id: "vecino", name: "Flujo del vecino", projectId: other.id, path: "otro" });
    store.flows.write(definition.id, "fila-origen", { value: "detalle-confidencial" });
    const event = { kind: "event" as const, path: [] };
    const graph: FlowDraftGraph = {
      schemaVersion: 2,
      nodes: [
        { id: "entrada", kind: "webhook", label: "Entrada" },
        {
          id: "leer",
          kind: "agent",
          agent: agent.id,
          prompt: "Resume",
          label: "Leer",
          input: event,
          autonomy: "total",
          write: "auto",
          delegate: true,
        },
        {
          id: "enviar",
          kind: "http",
          label: "Enviar",
          url: "https://destino.invalid/solo-origen",
          headers: [{ name: "X-Dato", value: "cabecera-privada" }],
          method: "POST",
          body: "cuerpo-privado",
          timeoutMs: 5000,
        },
      ],
      edges: [
        { source: "entrada", target: "leer" },
        { source: "leer", target: "enviar" },
      ],
      layout: [{ node: "leer", x: 172, y: -37 }],
    };
    const previous: FlowDraftGraph = {
      schemaVersion: 2,
      nodes: [{ kind: "webhook", id: "entrada", label: "Entrada anterior" }],
      edges: [],
      layout: [],
    };
    store.flowGraphs.saveDraft(definition.id, null, {
      ...previous,
      nodes: [{ kind: "webhook", id: "entrada", label: "Historial privado" }],
    });
    store.flowGraphs.saveDraft(definition.id, 1, previous);
    const released = store.flowGraphs.publish(definition.id, 2, null, () => {});
    store.flowGraphs.saveDraft(definition.id, released.draftVersion, graph);
    const out = await a.client.call("projects.export", { project: source.id });
    const published = await a.client.call("projects.share", { project: source.id, shared: true });
    const route = sharedProjectRoutes(a.home)(published.path ?? "");
    const served = await route?.handle(
      { method: "GET", path: "", headers: {}, body: Buffer.alloc(0) },
      new AbortController().signal,
    );
    const parsed = parsePackage(out.code);
    assert.equal(served?.status, 200);
    const publicContent = JSON.parse(String(served?.body));
    assert.deepEqual(publicContent.organization.flows, JSON.parse(out.content).organization.flows);
    assert.ok(parsed.ok);
    assert.equal(parsed.pkg.organization?.flows?.length, 1);
    for (const value of [
      definition.id,
      definition.path,
      source.id,
      other.id,
      agent.id,
      "Historial privado",
      "Flujo del vecino",
      "detalle-confidencial",
      "solo-origen",
      "cabecera-privada",
      "cuerpo-privado",
    ])
      assert.ok(!out.content.includes(value), value);
    const preview = await b.client.call("projects.import", { content: out.code, save: false, replace: false });
    assert.equal(preview.flows, 1);
    assert.ok(preview.flow_review?.includes("settings"));
    assert.deepEqual(b.core.store.flows.list(), []);
    const result = await b.client.call("projects.import", { content: out.code, save: true, replace: false });
    const id = result.project?.id;
    assert.ok(id);
    const saved = b.core.store.flows.list(id);
    assert.equal(saved.length, 1);
    const item = saved[0];
    assert.ok(item);
    assert.equal(item.enabled, false);
    assert.notEqual(item.path, definition.path);
    assert.notEqual(item.id, definition.id);
    assert.deepEqual(item.predicates, definition.predicates);
    assert.deepEqual(item.readKeys, definition.readKeys);
    const destAgent = b.core.store.agents.list().find((v) => v.project_id === id && v.slug === "lector");
    assert.ok(destAgent);
    assert.deepEqual(item.action, { ...definition.action, agent: destAgent.id });
    assert.deepEqual(item.knowledgeProjects ?? [], []);
    assert.deepEqual(b.core.store.flows.rows(item.id, 20), []);
    const doc = b.core.store.flowGraphs.get(item.id);
    assert.equal(doc.publishedRevision, null);
    const history = b.core.store.flowGraphs.history.list(item.id, () => null);
    assert.equal(history.length, 2);
    assert.deepEqual(b.core.store.flowGraphs.history.get(item.id, 1, () => null)?.graph, previous);
    assert.deepEqual(doc.draft?.edges, graph.edges);
    assert.deepEqual(doc.draft?.layout, graph.layout);
    const ai = doc.draft?.nodes.find((n) => n.kind === "agent");
    assert.equal(ai?.agent, destAgent.id);
    assert.equal(ai?.autonomy, "manual");
    assert.equal(ai?.write, undefined);
    assert.equal(ai?.delegate, false);
    const http = doc.draft?.nodes.find((n) => n.kind === "http");
    assert.equal(http?.url, "");
    assert.deepEqual(http?.headers, []);
    assert.equal(http?.body, "");
    const repeat = await b.client.call("projects.import", { content: out.code, save: true, replace: true });
    assert.ok(repeat.flow_review?.includes("existing"));
    assert.deepEqual(
      b.core.store.flows.list(id).map((f) => f.id),
      [item.id],
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    await a.core.close();
    await b.core.close();
    await a.cleanup();
    await b.cleanup();
  }
});

test("la importación admite paquetes antiguos, avisa de dibujos rotos y desvincula pasos externos de un fichero editado", async () => {
  const llm = scriptedLlm(() => say("prueba"));
  const b = await startCore({ llm });
  try {
    const legacy = {
      format: "colonia-proyecto-1",
      project: { name: "Proyecto antiguo" },
      exported_at: "2026-01-01",
      instructions: "",
      agents: [],
      skills: [],
      connections: [],
    };
    const prior = await b.client.call("projects.import", {
      content: JSON.stringify(legacy),
      save: true,
      replace: false,
    });
    assert.equal(prior.saved, true);
    assert.deepEqual(b.core.store.flows.list(), []);
    const base = {
      key: "a".repeat(32),
      name: "Prueba",
      predicates: [],
      tableKey: "actual",
      action: { kind: "agent", agent: "superagent", prompt: "Lee los datos" },
    };
    const event = { kind: "event", path: [] };
    const nodes = [
      { kind: "webhook", id: "in", label: "Entrada" },
      {
        kind: "agent",
        id: "ag",
        label: "Leer",
        agent: "superagent",
        model: "codex",
        autonomy: "total",
        write: "auto",
        delegate: true,
        prompt: "Contar",
        input: event,
      },
      {
        kind: "vars",
        id: "dato",
        label: "Dato",
        vars: [{ name: "API_KEY", value: { kind: "literal", value: "contenido-privado" } }],
      },
      {
        kind: "cmd",
        id: "orden",
        label: "Comando",
        command: "orden local de prueba",
        env: [{ name: "X_DATO", value: "valor-privado" }],
        stdin: "entrada-privada",
        timeoutMs: 5000,
        continueOnError: false,
      },
    ];
    const drawing = { schemaVersion: 2, nodes, edges: [{ source: "in", target: "ag" }], layout: [] };
    const broken = {
      ...base,
      key: "b".repeat(32),
      name: "Dibujo incompleto",
      drawing: { ...drawing, edges: [{ source: "in", target: "inexistente" }] },
    };
    const malformed = { ...base, enabled: true };
    const file = (flows: unknown[]) =>
      JSON.stringify({
        ...legacy,
        project: { name: "Proyecto de destino" },
        organization: { areas: [], roles: [], flows },
      });
    await assert.rejects(b.client.call("projects.import", { content: file([malformed]), save: true, replace: false }));
    assert.equal(
      b.core.store.projects.list().some((p) => p.name === "Proyecto de destino"),
      false,
    );
    const preview = await b.client.call("projects.import", {
      content: file([{ ...base, drawing }, broken]),
      save: false,
      replace: false,
    });
    assert.equal(preview.flows, 1);
    assert.ok(preview.flow_review?.includes("agents"));
    assert.ok(preview.flow_review?.includes("invalid"));
    assert.deepEqual(b.core.store.flows.list(), []);
    const result = await b.client.call("projects.import", {
      content: file([{ ...base, drawing }, broken]),
      save: true,
      replace: false,
    });
    assert.ok(result.project?.id);
    const saved = b.core.store.flows.list(result.project.id);
    assert.equal(saved.length, 1);
    const item = saved[0];
    assert.ok(item);
    assert.equal(item.enabled, false);
    assert.deepEqual(item.action, { kind: "none" });
    const doc = b.core.store.flowGraphs.get(item.id);
    assert.equal(doc.publishedRevision, null);
    const ai = doc.draft?.nodes.find((n) => n.kind === "agent");
    assert.equal(ai?.agent, "");
    assert.equal(ai?.autonomy, undefined);
    assert.equal(ai?.write, "read-only");
    const cmd = doc.draft?.nodes.find((n) => n.kind === "cmd");
    assert.equal(cmd?.command, "");
    assert.deepEqual(cmd?.env, []);
    assert.equal(cmd?.stdin, "");
    assert.equal(JSON.stringify(doc).includes("contenido-privado"), false);
    assert.equal(llm.calls.length, 0);
  } finally {
    await b.core.close();
    await b.cleanup();
  }
});
