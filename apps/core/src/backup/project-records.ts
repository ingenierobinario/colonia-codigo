import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createBus } from "../bus.ts";
import { PackageFlow, PROJECT_FORMAT, type ProjectPackage, scrub } from "../domain/project-package.ts";
import { importProjectFlows, reviewProjectFlows, withProjectFlows } from "../domain/project-package-flows.ts";
import { newId } from "../domain/sql.ts";
import { createStore } from "../domain/store.ts";
import { ArchiveError } from "./archive.ts";

type Value = string | number | null;
export type RecordRow = Record<string, Value>;
const OWN = `WITH RECURSIVE
 own_threads(id) AS (
   SELECT id FROM threads WHERE project_id=$p UNION
   SELECT t.id FROM threads t JOIN own_threads o ON t.parent_id=o.id WHERE t.project_id IS NULL
 ), own_agents(id) AS (
   SELECT id FROM agents WHERE project_id=$p UNION
   SELECT a.id FROM agents a JOIN own_agents o ON a.parent=o.id WHERE a.project_id IS NULL
 ), own_tasks(id) AS (SELECT id FROM tasks WHERE project_id=$p AND thread_id IN own_threads),
 own_messages(id) AS (SELECT id FROM messages WHERE thread_id IN own_threads),
 referenced(id) AS (
   SELECT media_id FROM message_media WHERE message_id IN own_messages UNION
   SELECT media_id FROM task_attachments WHERE task_id IN own_tasks
 ) `;
const sections = {
  projects: ["id name blob created_at description kind context memory_md context_chars mark", "id=$p", "p"],
  agents: [
    "id name role kind blob prompt created_at model model_choice slug source parent description archived extra",
    "id IN own_agents",
    "ag",
  ],
  threads: [
    "id kind title agent_ids parent_id preview created_at updated_at custom_title pinned archived task_id",
    "id IN own_threads",
    "th",
  ],
  tasks: [
    "id title description status state assignee parent_id thread_id awaits_owner due_at created_by created_at updated_at activity_at kind priority tags outcome start_at reviewer plan proposed",
    "id IN own_tasks",
    "task",
  ],
  surfaces: [
    "id name title html version pinned app thread_id created_by updated_at state logo",
    "(project_id=$p AND (thread_id IS NULL OR thread_id IN own_threads)) OR (project_id IS NULL AND thread_id IN own_threads)",
    "sf",
  ],
  media: [
    "id kind mime bytes thread_id prompt created_at",
    `id IN referenced AND (thread_id IN own_threads OR (thread_id IS NULL AND
      NOT EXISTS (SELECT 1 FROM message_media x WHERE x.media_id=media.id AND x.message_id NOT IN own_messages) AND
      NOT EXISTS (SELECT 1 FROM task_attachments x WHERE x.media_id=media.id AND x.task_id NOT IN own_tasks)))`,
    "med",
  ],
  messages: ["id thread_id seq author parts model created_at", "id IN own_messages", "msg"],
  task_attachments: ["task_id media_id source_media_id source_thread_id created_by", "task_id IN own_tasks", ""],
  task_events: ["task_id at op by data", "task_id IN own_tasks", ""],
  memories: [
    "id scope agent_id text source author_agent thread_id created_at updated_at tainted pending forgotten_at revision kind",
    "project_id=$p OR (project_id IS NULL AND scope='agent' AND agent_id IN own_agents)",
    "mem",
  ],
  routines: [
    "id name agent_id schedule prompt created_at updated_at call_model max_steps",
    "project_id=$p AND (agent_id IN own_agents OR agent_id='superagent')",
    "rt",
  ],
  flow_table_defs: ["name columns created_at updated_at required", "project_id=$p", ""],
  flow_tables: ["name key value updated_at", "project_id=$p", ""],
} as const;
export type Section = keyof typeof sections;
export const sectionNames = Object.keys(sections) as Section[];
const projectOwned = new Set<Section>([
  "agents",
  "threads",
  "tasks",
  "surfaces",
  "memories",
  "routines",
  "flow_table_defs",
  "flow_tables",
]);
const bad = () => new ArchiveError("broken");
export const validRecordId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w.-]{1,128}$/.test(value) && ![".", ".."].includes(value);
const select = (section: Section, columns: string) =>
  `${OWN} SELECT ${columns} FROM ${section} WHERE ${sections[section][1]}`;
export function sourceRows(
  db: DatabaseSync,
  project: string,
  section: Section,
  columns = sections[section][0].split(" ").join(","),
) {
  return db.prepare(select(section, columns)).iterate({ p: project }) as Iterable<RecordRow>;
}

export type Ids = Map<Section, Map<string, string>> & { agentSlugs: Set<string> };
export const makeIds = (): Ids =>
  Object.assign(new Map(sectionNames.map((s) => [s, new Map<string, string>()])), { agentSlugs: new Set<string>() });
const ref = (ids: Ids, table: Section, value: unknown) =>
  typeof value === "string" ? (ids.get(table)?.get(value) ?? null) : null;
const agentRef = (ids: Ids, value: unknown) => (value === "superagent" ? value : ref(ids, "agents", value));
export function indexId(ids: Ids, section: Section, row: RecordRow, fresh: boolean) {
  if (!sections[section][2]) return;
  if (!validRecordId(row.id)) throw bad();
  const map = ids.get(section) as Map<string, string>;
  if (map.has(row.id) || (section === "agents" && row.id === "superagent")) throw bad();
  if (section === "agents" && typeof row.slug === "string" && /^[a-z][a-z0-9_-]{0,80}$/.test(row.slug))
    ids.agentSlugs.add(row.slug);
  map.set(row.id, fresh ? newId(sections[section][2]) : row.id);
}
export function sourceIds(db: DatabaseSync, project: string): Ids {
  const ids = makeIds();
  for (const s of sectionNames)
    if (sections[s][2])
      for (const row of sourceRows(db, project, s, s === "agents" ? "id,slug" : "id")) indexId(ids, s, row, false);
  return ids;
}
function json(raw: unknown) {
  try {
    return JSON.parse(String(raw ?? "null"));
  } catch {
    throw bad();
  }
}
const text = (s: unknown) => (typeof s === "string" ? scrub(s).text : "");
function partsOf(raw: Value | undefined, ids: Ids) {
  const parts: unknown = json(raw);
  if (!Array.isArray(parts)) throw bad();
  return JSON.stringify(
    parts.flatMap<Record<string, unknown>>((part) => {
      if (!part || typeof part !== "object") return [];
      switch (part.type) {
        case "text":
          return [{ type: "text", text: text(part.text) }];
        case "image":
        case "audio":
        case "file": {
          const media = ref(ids, "media", part.media_id);
          if (!media) return [];
          if (part.type === "file")
            return [{ type: "file", media_id: media, name: text(part.name), mime: part.mime, bytes: part.bytes }];
          if (part.type === "audio")
            return [{ type: "audio", media_id: media, mime: part.mime, transcript: text(part.transcript) }];
          return [{ type: "image", media_id: media, mime: part.mime, alt: text(part.alt) }];
        }
        case "surface": {
          const surface = ref(ids, "surfaces", part.surface_id);
          return surface
            ? [{ type: "surface", surface_id: surface, version: part.version, title: text(part.title) }]
            : [];
        }
        case "subthread": {
          const thread = ref(ids, "threads", part.thread_id);
          const agent = agentRef(ids, part.agent_id);
          return thread && agent
            ? [
                {
                  type: "subthread",
                  thread_id: thread,
                  agent_id: agent,
                  title: text(part.title),
                  state: part.state,
                  summary: text(part.summary),
                },
              ]
            : [{ type: "text", text: text(part.summary ?? part.title) }];
        }
        case "tool":
          return [
            {
              type: "tool",
              tool: part.tool,
              call_id: part.call_id,
              title: text(part.title),
              status: part.status === "running" ? "ok" : part.status,
              detail: text(part.detail),
            },
          ];
        default: {
          // Una tarjeta antigua puede identificar una operación, permiso, carpeta o cuenta de la otra instalación.
          const note = [part.title, part.text, part.summary, part.detail].map(text).filter(Boolean).join("\n");
          return note ? [{ type: "text", text: note }] : [];
        }
      }
    }),
  );
}
function authorOf(raw: Value | undefined, ids: Ids) {
  const a = json(raw);
  if (a?.kind === "agent" && agentRef(ids, a.id)) return JSON.stringify({ kind: "agent", id: agentRef(ids, a.id) });
  if (a?.kind === "surface" && ref(ids, "surfaces", a.id))
    return JSON.stringify({ kind: "surface", id: ref(ids, "surfaces", a.id), title: text(a.title) });
  return JSON.stringify({ kind: a?.kind === "user" ? "user" : "system" });
}
const primitives = (value: unknown): value is Value =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || value === null;
export function normalized(section: Section, input: unknown, ids: Ids): RecordRow | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad();
  const original = input as RecordRow;
  const fields = sections[section][0].split(" ");
  if (
    Object.keys(original).length !== fields.length ||
    !fields.every((k) => Object.hasOwn(original, k) && primitives(original[k]))
  )
    throw bad();
  const row: RecordRow = Object.fromEntries(
    fields.map((k) => [k, typeof original[k] === "string" ? text(original[k]) : (original[k] ?? null)]),
  );
  if (sections[section][2]) {
    row.id = ref(ids, section, original.id);
    if (!row.id) throw bad();
  }
  if (Object.hasOwn(row, "thread_id")) row.thread_id = ref(ids, "threads", original.thread_id);
  if (Object.hasOwn(row, "agent_id")) row.agent_id = agentRef(ids, original.agent_id);
  if (Object.hasOwn(row, "task_id")) row.task_id = ref(ids, "tasks", original.task_id);
  for (const key of ["assignee", "reviewer", "author_agent"])
    if (Object.hasOwn(row, key)) row[key] = agentRef(ids, original[key]);
  for (const key of ["by", "created_by"])
    if (Object.hasOwn(row, key)) row[key] = agentRef(ids, original[key]) ?? "owner";
  if (section === "agents") {
    const details = json(original.extra) ?? {};
    const extras: Record<string, string | boolean | string[]> = Object.fromEntries(
      ["area", "personality", "orchestrator", "emoji"]
        .filter((key) => typeof details[key] === "string" || typeof details[key] === "boolean")
        .map((key) => [key, typeof details[key] === "boolean" ? details[key] : text(details[key])]),
    );
    for (const key of ["skills", "aliases"])
      if (Array.isArray(details[key]))
        extras[key] = details[key].filter(
          (item: unknown) => typeof item === "string" && /^[a-z0-9_-]{1,100}$/i.test(item),
        );
    row.extra = JSON.stringify(extras);
    row.parent =
      ref(ids, "agents", original.parent) ??
      (typeof original.parent === "string" && ids.agentSlugs.has(original.parent) ? original.parent : null);
  }
  if (section === "threads") {
    row.parent_id = ref(ids, "threads", original.parent_id);
    const agents = json(original.agent_ids);
    if (!Array.isArray(agents)) throw bad();
    row.agent_ids = JSON.stringify(agents.map((id) => agentRef(ids, id)).filter(Boolean));
    if (["channel", "home"].includes(String(row.kind))) row.kind = "loose";
  }
  if (section === "tasks") row.parent_id = ref(ids, "tasks", original.parent_id);
  if (section === "messages") {
    row.author = authorOf(original.author, ids);
    row.parts = partsOf(original.parts, ids);
  }
  if (section === "memories") {
    row.scope = row.agent_id && row.scope === "agent" ? "agent" : "project";
    row.pending = 0;
  }
  if (section === "task_attachments") {
    row.media_id = ref(ids, "media", original.media_id);
    if (!row.media_id) return undefined;
    row.source_media_id = ref(ids, "media", original.source_media_id) ?? row.media_id;
    row.source_thread_id = ref(ids, "threads", original.source_thread_id);
  }
  return row;
}

export function insertRecord(
  db: DatabaseSync,
  section: Section,
  row: RecordRow,
  project: string,
  root: string,
  mediaPath: (id: string) => string,
) {
  if (section === "projects") row.path = root;
  if (projectOwned.has(section)) row.project_id = project;
  if (section === "media") row.path = mediaPath(String(row.id));
  if (section === "routines") row.enabled = 0;
  const keys = Object.keys(row);
  const statement = db.prepare(`INSERT INTO ${section} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`);
  statement.run(...keys.map((k) => row[k] as SQLInputValue));
}

function skeleton(projectName: string, slugs: unknown[]): ProjectPackage {
  return {
    format: PROJECT_FORMAT,
    exported_at: new Date().toISOString(),
    project: { name: projectName },
    instructions: "",
    agents: slugs
      .filter((v): v is string => typeof v === "string" && /^[a-z][a-z0-9_-]{0,80}$/.test(v))
      .map((slug) => ({ slug, text: "" })),
    skills: [],
    connections: [],
  };
}
export function sourceFlows(db: DatabaseSync, project: string, name: string) {
  const slugs = [...sourceRows(db, project, "agents", "slug")].map((r) => r.slug);
  return withProjectFlows(createStore(db, createBus()), project, skeleton(name, slugs)).organization?.flows ?? [];
}
export function restoreFlows(db: DatabaseSync, incoming: unknown, project: string, name: string) {
  const flows = PackageFlow.array().max(1000).safeParse(incoming);
  if (!flows.success) throw bad();
  const slugs = db
    .prepare("SELECT slug FROM agents WHERE project_id=?")
    .all(project)
    .map((r) => r.slug);
  const pkg = { ...skeleton(name, slugs), organization: { areas: [], roles: [], flows: flows.data } };
  importProjectFlows(createStore(db, createBus()), project, reviewProjectFlows(pkg));
}
