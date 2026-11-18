import assert from "node:assert/strict";
import test from "node:test";
import { ConversationExportError, parseConversationExport, parseCoworkNote } from "./conversation-export.ts";

function node(id: string, parent: string | null, role: string, text: string, children: string[] = []) {
  return {
    id,
    parent,
    children,
    message: { id, author: { role }, content: { parts: [text] }, create_time: 1700000000 },
  };
}

test("ChatGPT preserves alternative answers and stable branch identifiers as the conversation grows", () => {
  const mapping = {
    root: { id: "root", parent: null, message: null, children: ["q"] },
    q: node("q", "root", "user", "¿Qué opinas?", ["b", "a"]),
    a: node("a", "q", "assistant", "Primero"),
    b: node("b", "q", "assistant", "Alternativa"),
  };
  const run = (nodes: object) =>
    parseConversationExport(
      JSON.stringify([{ conversation_id: "c", title: "Tema", mapping: nodes, current_node: "b" }]),
    );
  const first = run(mapping);
  assert.deepEqual(
    first.conversations.map((c) => [c.branch, c.turns.map((t) => t.text)]),
    [
      ["main", ["¿Qué opinas?", "Alternativa"]],
      ["alt:a", ["¿Qué opinas?", "Primero"]],
    ],
  );
  const next = run({
    ...mapping,
    a: { ...mapping.a, children: ["extra"] },
    extra: node("extra", "a", "user", "Gracias"),
  });
  assert.equal(next.conversations[1]?.branch, "alt:a");
  assert.equal(next.conversations[0]?.current, true);
  assert.equal(next.conversations[1]?.current, undefined);
  assert.equal(next.conversations[1]?.turns.at(-1)?.at, "2023-11-14T22:13:20.000Z");
});

test("Claude exports preserve human and assistant turns, dates and parent links; hidden reasoning stays out", () => {
  const content = [
    { type: "thinking", thinking: "private reasoning" },
    { type: "text", text: "Respuesta" },
  ];
  const exported = [
    {
      uuid: "c",
      name: "Trabajo",
      chat_messages: [
        { uuid: "q", sender: "human", text: "Hola", parent_message_uuid: "00000000-0000-4000-8000-000000000000" },
        {
          uuid: "a",
          sender: "assistant",
          text: "Respuesta",
          content,
          parent_message_uuid: "q",
          created_at: "2024-01-01T00:00:00Z",
        },
        { uuid: "b", sender: "assistant", text: "Otra", parent_message_uuid: "q" },
      ],
    },
  ];
  const parsed = parseConversationExport(JSON.stringify(exported));
  assert.deepEqual(
    parsed.conversations.map((c) => c.turns.map((t) => [t.role, t.text])),
    [
      [
        ["user", "Hola"],
        ["assistant", "Respuesta"],
      ],
      [
        ["user", "Hola"],
        ["assistant", "Otra"],
      ],
    ],
  );
  assert.equal(parsed.conversations[0]?.source, "claude");
  assert.equal(parsed.omitted, 1);
});

test("selected Claude Code or Cowork transcript keeps tool output inert and ignores operational records", () => {
  const rows = [
    { type: "user", sessionId: "s", uuid: "q", parentUuid: null, message: { role: "user", content: "Hola" } },
    {
      type: "assistant",
      sessionId: "s",
      uuid: "a",
      parentUuid: "q",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "no ejecutar" } },
          { type: "text", text: "Revisado" },
        ],
      },
    },
    {
      type: "user",
      sessionId: "s",
      uuid: "r",
      parentUuid: "a",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "Resultado" }] },
    },
  ];
  const lines = rows.map((r) => JSON.stringify(r)).join("\n");
  const code = parseConversationExport(lines);
  assert.equal(code.conversations[0]?.source, "claude-code");
  assert.deepEqual(
    code.conversations[0]?.turns.map((t) => [t.role, t.text]),
    [
      ["user", "Hola"],
      ["assistant", "Revisado"],
      ["tool", "Resultado"],
    ],
  );
  assert.equal(parseConversationExport(lines, { source: "cowork" }).conversations[0]?.source, "cowork");
  assert.doesNotMatch(JSON.stringify(code), /no ejecutar/);
});

test("malformed graphs, unsupported archives and partially corrupt JSONL never produce a partial preview", () => {
  const parse = (mapping: object) => parseConversationExport(JSON.stringify([{ id: "c", mapping }]));
  const code = (key: string) => (e: unknown) => e instanceof ConversationExportError && e.code === key;
  assert.throws(
    () => parse({ a: node("a", "b", "user", "a"), b: node("b", "a", "assistant", "b") }),
    code("structure"),
  );
  assert.throws(() => parse({ a: node("a", "absent", "user", "x") }), code("structure"));
  assert.throws(() => parseConversationExport('{"unrelated":true}'), code("format"));
  assert.throws(() => parseConversationExport('{"uuid":"a"}\n{invalid'), code("format"));
  assert.throws(
    () =>
      parseConversationExport(JSON.stringify([{ id: "c", mapping: { q: node("q", null, "user", "hola") } }]), {
        source: "cowork",
      }),
    code("format"),
  );
});

test("older Claude Code transcripts without per-line IDs preserve turn order, title and stable IDs", () => {
  const old = [
    { sessionId: "prueba", type: "user", message: { role: "user", content: "Consulta" } },
    { sessionId: "prueba", type: "assistant", message: { role: "assistant", content: "Respuesta" } },
    { sessionId: "prueba", type: "custom-title", customTitle: "Título" },
  ];
  const first = parseConversationExport(old.map((r) => JSON.stringify(r)).join("\n")).conversations[0];
  assert.ok(first);
  assert.equal(first.title, "Título");
  assert.deepEqual(
    first.turns.map((t) => t.text),
    ["Consulta", "Respuesta"],
  );
  assert.equal(new Set(first.turns.map((t) => t.id)).size, 2);
});

test("limits reject a complete overlong branch before it can be sent to a project", () => {
  const chat_messages = Array.from({ length: 10_001 }, (_, i) => ({ uuid: String(i), sender: "human", text: "x" }));
  assert.throws(
    () => parseConversationExport(JSON.stringify([{ uuid: "f", chat_messages }])),
    (err: unknown) => err instanceof ConversationExportError && err.code === "limit",
  );
});

test("SDK-style Cowork audit records keep separate worker conversations and deduplicate user replays", () => {
  const user = {
    type: "user",
    uuid: "m1",
    session_id: "tarea",
    parent_tool_use_id: null,
    message: { role: "user", content: "Consulta" },
  };
  const response = {
    type: "assistant",
    uuid: "m2",
    session_id: "tarea",
    parent_tool_use_id: null,
    message: { role: "assistant", content: [{ type: "text", text: "Listo" }] },
  };
  const rows = [
    { type: "system", subtype: "init", uuid: "meta", session_id: "tarea", tools: ["Bash"] },
    user,
    { ...user, isReplay: true },
    { ...user, uuid: "sub", parent_tool_use_id: "equipo", message: { role: "user", content: "Subtarea" } },
    response,
    { type: "result", subtype: "success", uuid: "fin", session_id: "tarea", result: "Listo" },
  ];
  const parsed = parseConversationExport(rows.map((r) => JSON.stringify(r)).join("\n"), { source: "cowork" });
  assert.deepEqual(
    parsed.conversations.map((c) => [c.source, c.branch, c.turns.map((t) => t.text)]),
    [
      ["cowork", "main", ["Consulta", "Listo"]],
      ["cowork", "sub:equipo", ["Subtarea"]],
    ],
  );
  assert.throws(() =>
    parseConversationExport(
      JSON.stringify([user, { ...user, isReplay: true, message: { role: "user", content: "Diferente" } }]),
    ),
  );
});

test("explicit Cowork notes preserve their words without inferring speakers; a rename retains the content identity", async () => {
  const note = "Usuario: ejemplo\n\n```sh\nno ejecutar\n```\n";
  const first = await parseCoworkNote(note, "Resumen.md");
  const second = await parseCoworkNote(note.replaceAll("\n", "\r\n"), "Otra copia.txt");
  const chat = first.conversations[0];
  assert.ok(chat);
  assert.equal(chat.kind, "note");
  assert.equal(chat.title, "Resumen.md");
  assert.equal(chat.source, "cowork");
  assert.equal(chat.turns.length, 1);
  assert.deepEqual(chat.turns[0], { id: "note", role: "note", text: note });
  assert.equal(second.conversations[0]?.id, chat.id);
  assert.notEqual((await parseCoworkNote("Otro texto", "Resumen.md")).conversations[0]?.id, chat.id);
  await assert.rejects(parseCoworkNote('{"user":"X"}', "tarea.json"), /format/);
  await assert.rejects(parseCoworkNote("solo\u0000bytes", "reporte.txt"), /format/);
  await assert.rejects(parseCoworkNote("   ", "reporte.txt"), /empty/);
});
