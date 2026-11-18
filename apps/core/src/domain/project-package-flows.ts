import { createHash, randomUUID } from "node:crypto";
import type { FlowDraftGraph, FlowDraftNode } from "@colonia/protocol/flow-graph";
import type { FlowDefinition, ProjectFlowReview } from "@colonia/protocol/flow-methods";
import { redactedJson } from "../log.ts";
import { matchesFlowPredicates } from "./flow-evaluate.ts";
import { flowNodeBindings, flowVarIndex } from "./flow-graph-validate.ts";
import { PackageFlow, type ProjectPackage, REMOVED, scrub } from "./project-package.ts";
import { isCliRef } from "./refs.ts";
import type { Store } from "./store.ts";

type Review = Set<ProjectFlowReview>;
type AgentMap = ReadonlyMap<string, string>;
const keyOf = (scope: string, id: string) =>
  createHash("sha256").update(scope).update("\0").update(id).digest("hex").slice(0, 32);
const sensitive = (name: string) => scrub(`${name}=colonia_prueba_1234`).removed > 0;

function localAgent(agents: AgentMap, value: string, review: Review) {
  const local = agents.get(value);
  if (!local) review.add("agents");
  return local ?? "";
}

/** Conserva tipo, etiqueta y conexiones de cada paso. Los envíos, comandos y bases de datos se configuran localmente. */
function portableNode(node: FlowDraftNode, agents: AgentMap, review: Review): FlowDraftNode {
  const settings = () => review.add("settings");
  switch (node.kind) {
    case "http":
      settings();
      return { ...node, url: "", headers: [], body: "" };
    case "notify":
      settings();
      return {
        ...node,
        channel: "",
        to: node.to.kind === "room" ? { kind: "room", room: "" } : { kind: "contact", person: "" },
        text: "",
      };
    case "cmd":
      settings();
      return { ...node, command: "", env: [], stdin: "" };
    case "sql":
      settings();
      return { ...node, database: "", query: "", params: [] };
    case "js":
      settings();
      return { ...node, code: "" };
    case "routine":
      review.add("routines");
      return { ...node, routine: "" };
    case "agent": {
      const cli = Boolean(node.model && isCliRef(node.model));
      if (node.autonomy === "total" || node.autonomy === "auto" || node.write === "auto" || node.delegate) settings();
      return {
        ...node,
        ...(node.agent ? { agent: localAgent(agents, node.agent, review) } : {}),
        autonomy: cli ? undefined : "manual",
        write: cli ? "read-only" : undefined,
        delegate: false,
      };
    }
    case "table_read":
    case "table_write":
      if (node.table) review.add("tables");
      if (node.kind === "table_write" && node.columns)
        return {
          ...node,
          columns: node.columns.map((column) => {
            if (!sensitive(column.name) || !column.value) return column;
            settings();
            return { ...column, value: "" };
          }),
        };
      return node;
    case "vars":
      return {
        ...node,
        vars: node.vars.map((variable) => {
          if (!sensitive(variable.name)) return variable;
          settings();
          return { ...variable, value: { kind: "literal", value: "" } };
        }),
      };
    case "condition":
      if ((node.input.kind === "event" || node.input.kind === "node") && node.input.path.some(sensitive)) {
        settings();
        return { ...node, equals: REMOVED, cases: undefined };
      }
      return node;
    case "llm":
    case "schedule":
    case "webhook":
      return node;
  }
}

function hasBrokenLinks(graph: FlowDraftGraph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const variables = flowVarIndex(graph);
  return (
    ids.size !== graph.nodes.length ||
    graph.edges.some((e) => !ids.has(e.source) || !ids.has(e.target)) ||
    graph.layout.some((position) => !ids.has(position.node)) ||
    graph.nodes.some((node) =>
      flowNodeBindings(node, variables).some((binding) => binding.kind === "node" && !ids.has(binding.node)),
    )
  );
}

function portableFlow(flow: PackageFlow, agents: AgentMap, review: Review): PackageFlow | undefined {
  const drawing = (g: FlowDraftGraph) => ({ ...g, nodes: g.nodes.map((node) => portableNode(node, agents, review)) });
  let action: FlowDefinition["action"] = { kind: "none" };
  if (flow.action.kind === "agent") {
    const agent = localAgent(agents, flow.action.agent, review);
    if (agent) action = { ...flow.action, agent };
  } else if (flow.action.kind === "routine") review.add("routines");
  const raw = {
    name: flow.name,
    tableKey: flow.tableKey,
    readKeys: flow.readKeys,
    action,
    predicates: flow.predicates.map((p) => {
      if (!p.path.some(sensitive)) return p;
      review.add("settings");
      return { ...p, equals: REMOVED };
    }),
    ...(flow.drawing ? { drawing: drawing(flow.drawing) } : {}),
    ...(flow.previousDrawing ? { previousDrawing: drawing(flow.previousDrawing) } : {}),
  };
  // Pasa también por aquí un fichero recibido de otro editor. Los campos estructurales tienen que seguir siendo válidos.
  const cleaned: Record<string, unknown> = JSON.parse(redactedJson(raw), (_key: string, value: unknown) => {
    if (typeof value !== "string") return value;
    const text = scrub(value).text.replace(
      /\b(?:https?|wss?|ftp|file|secret):\/\/[^\s<>"']+|\b[A-Za-z]:[\\/][^\s<>"']+|\/(?:Users|home)\/[^\s<>"']+/gi,
      REMOVED,
    );
    if (text !== value) review.add("settings");
    return text;
  });
  const parsed = PackageFlow.safeParse({ ...cleaned, key: flow.key });
  if (parsed.success && ![parsed.data.previousDrawing, parsed.data.drawing].some((g) => g && hasBrokenLinks(g))) {
    try {
      matchesFlowPredicates({}, parsed.data.predicates);
      return parsed.data;
    } catch {
      // Una ruta reservada del objeto tampoco es válida para una definición local.
    }
  }
  review.add("invalid");
  return undefined;
}

function addFlows(pkg: ProjectPackage, flows: PackageFlow[], review: Review): ProjectPackage {
  if (!flows.length && !review.size) return pkg;
  return { ...pkg, organization: { areas: [], roles: [], ...pkg.organization, flows, flowReview: [...review] } };
}

/** Solo lee las definiciones y los dos dibujos vigentes del proyecto. La identidad del origen se convierte en una clave opaca. */
export function withProjectFlows(store: Store, project: string, pkg: ProjectPackage): ProjectPackage {
  const sources = store.flows.list(project);
  if (!sources.length) return pkg;
  const exported = new Set(pkg.agents.map((a) => a.slug));
  const agents = new Map(
    store.agents
      .list()
      .filter((a) => a.project_id === project && a.slug && exported.has(a.slug))
      .map((a) => [a.id, a.slug as string]),
  );
  const review: Review = new Set();
  const flows = sources.flatMap((flow) => {
    if (flow.knowledgeProjects?.length) review.add("knowledge");
    const doc = store.flowGraphs.get(flow.id);
    if (doc.draft && doc.published) review.add("versions");
    const current = doc.draft ?? doc.published;
    const safe = portableFlow(
      {
        ...flow,
        key: keyOf(project, flow.id),
        ...(current ? { drawing: current } : {}),
        ...(doc.published && doc.draft ? { previousDrawing: doc.published } : {}),
      },
      agents,
      review,
    );
    return safe ? [safe] : [];
  });
  return addFlows(pkg, flows, review);
}

/** Normaliza incluso paquetes editados a mano antes de mostrarlos. Ningún id del paquete puede designar un agente local ajeno. */
export function reviewProjectFlows(pkg: ProjectPackage): ProjectPackage {
  const flows = pkg.organization?.flows;
  if (!flows?.length) return pkg;
  const review: Review = new Set(pkg.organization?.flowReview);
  const slugs = new Map(pkg.agents.map((a) => [a.slug, a.slug]));
  return addFlows(
    pkg,
    flows.flatMap((f) => portableFlow(f, slugs, review) ?? []),
    review,
  );
}

export function importProjectFlows(store: Store, project: string, pkg: ProjectPackage): ProjectFlowReview[] {
  const review: Review = new Set(pkg.organization?.flowReview);
  const flows = pkg.organization?.flows;
  if (!flows?.length) return [...review];
  const agents = new Map(
    store.agents
      .list()
      .filter((a) => a.project_id === project && a.slug)
      .map((a) => [a.slug as string, a.id]),
  );
  store.tx(() => {
    for (const flow of flows) {
      const id = `flow_${keyOf(project, flow.key)}`;
      if (store.flows.get(id)) {
        review.add("existing");
        continue;
      }
      const safe = portableFlow(flow, agents, review);
      if (!safe) continue;
      const { drawing, previousDrawing, key: _, ...definition } = safe;
      store.flows.save({ ...definition, id, projectId: project, path: randomUUID(), enabled: false });
      const prior = previousDrawing ? store.flowGraphs.saveDraft(id, null, previousDrawing) : undefined;
      if (drawing) store.flowGraphs.saveDraft(id, prior?.draftVersion ?? null, drawing);
    }
  });
  return [...review];
}
