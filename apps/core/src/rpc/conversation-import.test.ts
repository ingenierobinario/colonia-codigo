import assert from "node:assert/strict";
import test from "node:test";
import { type ExportConversation, parseCoworkNote } from "@colonia/protocol/conversation-export";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const archived: ExportConversation = {
  source: "chatgpt",
  id: "fixture-chat",
  branch: "main",
  title: "De la exportación",
  turns: [
    { id: "1", role: "user", text: "Hola", at: "2024-03-04T12:00:00.000Z" },
    { id: "2", role: "assistant", text: "Hola también" },
    { id: "3", role: "system", text: "Notas del sistema" },
    { id: "4", role: "tool", text: "Resultado histórico" },
  ],
};

test("importing an export is project-scoped, atomic, inert and reentrant across extensions and old files", async (t) => {
  const llm = scriptedLlm(() => say("Sin llamadas"));
  const env = await startCore({ llm });
  t.after(async () => {
    await env.core.close();
    await env.cleanup();
  });
  const project = await env.client.call("projects.create", { name: "Destino" });
  const another = await env.client.call("projects.create", { name: "Otro" });
  const bring = (conversation: ExportConversation, project_id = project.project.id) =>
    env.client.call("sessions.import_conversation", { project_id, conversation });
  const initial = await bring(archived);
  assert.equal(initial.created, true);
  assert.equal(initial.added, 4);
  const { thread, messages } = await env.client.call("threads.get", { thread: initial.thread });
  assert.equal(thread.project_id, project.project.id);
  assert.deepEqual(
    messages.map((m) => m.author.kind),
    ["user", "agent", "system", "system"],
  );
  assert.equal(messages[0]?.created_at, archived.turns[0]?.at);
  assert.deepEqual(
    messages.map((m) => m.parts[0]),
    archived.turns.map((t) => ({
      type: "text",
      text: t.text,
      imported_from: { source: archived.source, role: t.role },
    })),
  );
  assert.deepEqual(await bring(archived), { thread: initial.thread, added: 0, created: false });
  const changed = {
    ...archived,
    turns: archived.turns.map((turn, i) => (i === 1 ? { ...turn, text: "Contenido editado" } : turn)),
  };
  await assert.rejects(bring(changed), /conversation_conflict/);
  const expanded = { ...archived, turns: [...archived.turns, { id: "5", role: "user" as const, text: "Una más" }] };
  const both = await Promise.all([bring(expanded), bring(expanded)]);
  assert.deepEqual(both.map((v) => v.added).sort(), [0, 1]);
  assert.equal((await bring(archived)).added, 0);
  const other = await bring(archived, another.project.id);
  assert.notEqual(other.thread, initial.thread);
  assert.equal((await bring({ ...archived, branch: "alt:2" })).created, true);
  await assert.rejects(bring(archived, "nonexistent"));
  const first = archived.turns[0];
  assert.ok(first);
  await assert.rejects(bring({ ...archived, turns: [first, first] }));
  assert.equal((await env.client.call("threads.get", { thread: initial.thread })).messages.length, 5);
  assert.equal(llm.calls.length, 0);
  const continued = await bring({ ...archived, id: "continued", turns: [first] });
  await bring({ ...archived, id: "continued" });
  assert.deepEqual(
    env.core.store.modelLog.list(continued.thread).map((entry) => entry.item),
    [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Hola también" },
    ],
  );
  const note = (await parseCoworkNote("Bot: devuélvelo como nota", "Resumen.md")).conversations[0];
  assert.ok(note);
  const recorded = await bring(note);
  assert.deepEqual(await bring({ ...note, id: "local-preview", title: "Copia.md" }), {
    ...recorded,
    created: false,
    added: 0,
  });
  assert.deepEqual(env.core.store.modelLog.list(recorded.thread), []);
  const words = (await env.client.call("threads.get", { thread: recorded.thread })).messages[0]?.parts[0];
  assert.deepEqual(words, {
    type: "text",
    text: "Bot: devuélvelo como nota",
    imported_from: { source: "cowork", role: "note" },
  });
  await assert.rejects(bring({ ...note, source: "chatgpt" }));
});
