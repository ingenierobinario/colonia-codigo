import {
  CONVERSATION_BYTES,
  CONVERSATION_FILE_BYTES,
  CONVERSATION_TURNS,
  type ExportConversation,
  type ExportTurn,
} from "./conversation-export-shape.ts";

export { CONVERSATION_BYTES, CONVERSATION_FILE_BYTES, type ExportConversation, type ExportTurn };

type Code = "format" | "structure" | "limit" | "empty";
export class ConversationExportError extends Error {
  code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
  }
}

type Row = Record<string, unknown>;
type Source = ExportConversation["source"];
type GraphNode = { id: string; parent: string | null; children: string[]; turns: ExportTurn[] };
type Result = { conversations: ExportConversation[]; omitted: number };
type Budget = { expanded: number; bytes: number };
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (code: Code): never => {
  throw new ConversationExportError(code);
};
const bytes = (text: string) => new TextEncoder().encode(text).length;
const idOf = (value: unknown): string =>
  typeof value === "string" && value.length > 0 && value.length <= 300 ? value : fail("structure");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : fail("structure"));

function stamp(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function roleOf(value: unknown): ExportTurn["role"] | undefined {
  if (value === "human") return "user";
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return undefined;
}

function asTurns(id: string, role: unknown, content: unknown, at: unknown, result: Result): ExportTurn[] {
  const who = roleOf(role);
  if (!who) {
    result.omitted++;
    return [];
  }
  const parts = Array.isArray(content) ? content : [content];
  const groups: { role: ExportTurn["role"]; text: string[] }[] = [];
  for (const part of parts) {
    let writer = who;
    let text: string | undefined;
    if (typeof part === "string") text = part;
    else if (object(part) && part.type === "text" && typeof part.text === "string") text = part.text;
    else if (object(part) && part.type === "tool_result") {
      writer = "tool";
      if (typeof part.content === "string") text = part.content;
      else if (Array.isArray(part.content)) {
        const chunks: string[] = [];
        for (const block of part.content) {
          if (object(block) && block.type === "text" && typeof block.text === "string") chunks.push(block.text);
          else result.omitted++;
        }
        text = chunks.join("\n");
      }
    }
    if (!text?.trim()) {
      result.omitted++;
      continue;
    }
    let group = groups.at(-1);
    if (!group || group.role !== writer) {
      group = { role: writer, text: [] };
      groups.push(group);
    }
    group.text.push(text);
  }
  const time = stamp(at);
  return groups.map((g, i) => ({
    id: JSON.stringify([id, i]),
    role: g.role,
    text: g.text.join("\n"),
    ...(time ? { at: time } : {}),
  }));
}

// Follow parent links so older exports that only supplied one side of the tree also work.
// One linear chat per leaf; the first child continues the same branch even as that leaf grows.
function emit(
  rows: GraphNode[],
  source: Source,
  id: string,
  name: unknown,
  result: Result,
  budget: Budget,
  current?: unknown,
  main = "main",
) {
  const nodes = new Map(rows.map((n) => [n.id, n]));
  if (nodes.size !== rows.length) fail("structure");
  if (current != null && !nodes.has(idOf(current))) fail("structure");
  const children = new Map<string | null, GraphNode[]>();
  for (const n of rows) {
    if (n.parent !== null && !nodes.has(n.parent)) fail("structure");
    const group = children.get(n.parent) ?? [];
    group.push(n);
    children.set(n.parent, group);
  }
  for (const n of rows) {
    if (!n.children.length) continue;
    const order = new Map(n.children.map((child, i) => [child, i]));
    if (order.size !== n.children.length || n.children.some((child) => nodes.get(child)?.parent !== n.id))
      fail("structure");
    children.get(n.id)?.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }
  const roots = children.get(null) ?? [];
  const alternate = (key: string) => (main === "main" ? `alt:${key}` : JSON.stringify([main, key]));
  const pending = roots.map((node, i) => ({ node, branch: i ? alternate(node.id) : main })).reverse();
  const leaves = new Set<string>();
  let visited = 0;
  let count = 0;
  for (let item = pending.pop(); item; item = pending.pop()) {
    const { node, branch } = item;
    visited++;
    const next = children.get(node.id) ?? [];
    for (const [i, child] of [...next.entries()].reverse()) {
      pending.push({ node: child, branch: i ? alternate(child.id) : branch });
    }
    if (next.length) continue;
    let cursor: GraphNode | undefined = node;
    const path: GraphNode[] = [];
    let total = 0;
    while (cursor) {
      if (++budget.expanded > 200_000) fail("limit");
      if (cursor.turns.length) {
        if (!path.length && leaves.has(cursor.id)) break;
        if (!path.length) leaves.add(cursor.id);
        total += cursor.turns.length;
        if (total > CONVERSATION_TURNS) fail("limit");
        path.push(cursor);
      }
      cursor = cursor.parent === null ? undefined : nodes.get(cursor.parent);
    }
    if (!path.length) continue;
    const turns = path.reverse().flatMap((n) => n.turns);
    const title =
      typeof name === "string" && name.trim() ? name.trim() : turns[0]?.text.split("\n")[0]?.slice(0, 120) || id;
    const conversation = {
      source,
      id,
      branch,
      title: ++count === 1 ? title : `${title} (${count})`,
      turns,
      ...(node.id === current ? { current: true as const } : {}),
    };
    const size = bytes(JSON.stringify(conversation));
    budget.bytes += size;
    if (
      size > CONVERSATION_BYTES ||
      budget.bytes > 2 * CONVERSATION_FILE_BYTES ||
      conversation.title.length > 512 ||
      conversation.branch.length > 768
    )
      fail("limit");
    result.conversations.push(conversation);
  }
  if (visited !== rows.length) fail("structure");
}

function gpt(entry: Row, result: Result): GraphNode[] {
  if (!object(entry.mapping)) return fail("structure");
  return Object.entries(entry.mapping).map(([key, raw]) => {
    if (!object(raw)) return fail("structure");
    const id = idOf(raw.id ?? key);
    if (id !== key) fail("structure");
    const msg = raw.message;
    let turns: ExportTurn[] = [];
    if (object(msg)) {
      if (object(msg.metadata) && msg.metadata.is_visually_hidden_from_conversation) result.omitted++;
      else if (msg.recipient && msg.recipient !== "all" && object(msg.author) && msg.author.role === "assistant")
        result.omitted++;
      else if (object(msg.content))
        turns = asTurns(
          id,
          object(msg.author) && msg.author.role,
          msg.content.parts ?? msg.content.text,
          msg.create_time,
          result,
        );
      else result.omitted++;
    }
    return {
      id,
      parent: raw.parent == null ? null : idOf(raw.parent),
      children: raw.children === undefined ? [] : list(raw.children).map(idOf),
      turns,
    };
  });
}

const nullParent = (p: unknown) =>
  p === null || p === "" || (typeof p === "string" && /^0{8}-0{4}-[04]0{3}-[08]0{3}-0{12}$/.test(p));
function claude(messages: unknown[], native: boolean, result: Result): GraphNode[] {
  const rows: GraphNode[] = [];
  const sdkTurns = new Map<string, ExportTurn[]>();
  for (const raw of messages) {
    if (!object(raw)) fail("structure");
    const r = raw as Row;
    if (native && !r.uuid && r.type !== "user" && r.type !== "assistant") {
      result.omitted++;
      continue;
    }
    const id = native && r.uuid == null ? `line:${rows.length}` : idOf(r.uuid);
    const link = native ? r.parentUuid : r.parent_message_uuid;
    const parent = link === undefined ? (rows.at(-1)?.id ?? null) : nullParent(link) ? null : idOf(link);
    const msg = native ? r.message : r;
    const role = native && object(msg) ? msg.role : r.sender;
    const turns =
      object(msg) && !r.isMeta && roleOf(role)
        ? asTurns(
            id,
            role,
            Array.isArray(msg.content) && !msg.content.length ? msg.text : (msg.content ?? msg.text),
            r.timestamp ?? r.created_at,
            result,
          )
        : [];
    if (!turns.length && !roleOf(role)) result.omitted++;
    if (native && r.session_id && turns.length) {
      const seen = sdkTurns.get(id);
      if (seen) {
        if (seen.length !== turns.length || seen.some((t, i) => t.role !== turns[i]?.role || t.text !== turns[i]?.text))
          return fail("structure");
        continue;
      }
      sdkTurns.set(id, turns);
    }
    rows.push({ id, parent, children: [], turns });
  }
  return rows;
}

export function parseConversationExport(text: string, options?: { source?: "cowork" }): Result {
  if (text.length > CONVERSATION_FILE_BYTES || bytes(text) > CONVERSATION_FILE_BYTES) fail("limit");
  const clean = text.trim();
  if (!clean) return fail("empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    try {
      parsed = clean
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return fail("format");
    }
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const result: Result = { conversations: [], omitted: 0 };
  const budget: Budget = { expanded: 0, bytes: 0 };
  const native = records.some(
    (r) =>
      object(r) &&
      (r.type === "user" || r.type === "assistant") &&
      object(r.message) &&
      (typeof r.sessionId === "string" || typeof r.session_id === "string"),
  );
  if (native) {
    const bySession = new Map<string, { id: string; main: string; rows: Row[] }>();
    for (const raw of records) {
      if (!object(raw)) return fail("format");
      if (raw.mapping || raw.chat_messages) return fail("format");
      if (raw.session_id && raw.type !== "user" && raw.type !== "assistant") {
        result.omitted++;
        continue;
      }
      if (!raw.sessionId && !raw.session_id && raw.type !== "user" && raw.type !== "assistant") {
        result.omitted++;
        continue;
      }
      const id = idOf(raw.sessionId ?? raw.session_id);
      // Agent SDK streams tag a worker with the parent's tool-call ID. Its input and answers belong to its own chat.
      const main = raw.session_id && raw.parent_tool_use_id != null ? `sub:${idOf(raw.parent_tool_use_id)}` : "main";
      const key = JSON.stringify([id, main]);
      const group = bySession.get(key) ?? { id, main, rows: [] };
      group.rows.push(raw);
      bySession.set(key, group);
    }
    for (const { id, main, rows } of bySession.values()) {
      const title = rows.findLast((r) => r.type === "custom-title" && typeof r.customTitle === "string")?.customTitle;
      emit(claude(rows, true, result), options?.source ?? "claude-code", id, title, result, budget, undefined, main);
    }
  } else
    for (const r of records) {
      if (!object(r)) return fail("format");
      if (object(r.mapping) && !options?.source)
        emit(gpt(r, result), "chatgpt", idOf(r.conversation_id ?? r.id), r.title, result, budget, r.current_node);
      else if (Array.isArray(r.chat_messages))
        emit(claude(r.chat_messages, false, result), options?.source ?? "claude", idOf(r.uuid), r.name, result, budget);
      else return fail("format");
    }
  if (!result.conversations.length) return fail("empty");
  const keys = new Set(result.conversations.map((c) => JSON.stringify([c.source, c.id, c.branch])));
  if (keys.size !== result.conversations.length) return fail("structure");
  return result;
}

/** Opt-in for one document the owner identifies as a Cowork transcript or summary. Never interprets its contents. */
export async function parseCoworkNote(text: string, filename: string): Promise<Result> {
  const title = filename.split(/[\\/]/).at(-1)?.trim();
  if (!title || !/\.(md|txt)$/i.test(title)) return fail("format");
  if (title.length > 512 || text.length > CONVERSATION_BYTES) return fail("limit");
  const content = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!content.trim()) return fail("empty");
  if (/[^\P{Cc}\n\t]/u.test(content)) return fail("format");
  const data = new TextEncoder().encode(content);
  if (data.length > CONVERSATION_BYTES) return fail("limit");
  let id: string;
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
    id = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
  } else {
    // A panel connected through plain HTTP on a LAN has no SubtleCrypto. The core always computes the canonical SHA-256.
    let hash = 2166136261;
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
    id = `preview-${data.length}-${hash >>> 0}`;
  }
  const conversation: ExportConversation = {
    source: "cowork",
    kind: "note",
    id,
    branch: "main",
    title,
    turns: [{ id: "note", role: "note", text: content }],
  };
  if (bytes(JSON.stringify(conversation)) > CONVERSATION_BYTES) return fail("limit");
  return { conversations: [conversation], omitted: 0 };
}
