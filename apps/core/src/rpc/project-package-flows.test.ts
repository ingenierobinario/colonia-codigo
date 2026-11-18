import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FlowDraftGraph } from "@colonia/protocol/flow-graph";
import { parsePackage } from "../domain/project-package.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

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
    store.flowGraphs.saveDraft(definition.id, null, graph);
    const out = await a.client.call("projects.export", { project: source.id });
    const parsed = parsePackage(out.code);
    assert.ok(parsed.ok);
    assert.equal(parsed.pkg.organization?.flows?.length, 1);
    for (const value of [
      definition.id,
      definition.path,
      source.id,
      other.id,
      agent.id,
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
    assert.deepEqual(doc.draft?.edges, graph.edges);
    assert.deepEqual(doc.draft?.layout, graph.layout);
    const ai = doc.draft?.nodes.find((n) => n.kind === "agent");
    assert.equal(ai?.agent, destAgent.id);
    assert.equal(ai?.autonomy, "manual");
    assert.equal(ai?.write, "read-only");
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
