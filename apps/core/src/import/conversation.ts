import { createHash } from "node:crypto";
import type { ExportConversation } from "@colonia/protocol/conversation-export";
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import { newestImportedHistory } from "./native-import.ts";

const digest = (fields: unknown[]) => createHash("sha256").update(JSON.stringify(fields)).digest("hex");

/** Imports only the words selected in the panel. No live engine, filesystem or provider is involved. */
export function importConversation(store: Store, project: string, owner: string, chat: ExportConversation) {
  const id =
    chat.kind === "note"
      ? createHash("sha256")
          .update(chat.turns[0]?.text ?? "")
          .digest("hex")
      : chat.id;
  const key = `conversation_import:${digest([project, chat.source, chat.kind ?? "chat", id, chat.branch])}`;
  if (new Set(chat.turns.map((t) => t.id)).size !== chat.turns.length) throw badRequest("conversation_conflict");
  const signed = chat.turns.map((turn) => ({
    turn,
    signature: digest([turn.id, turn.role, turn.text, turn.at ?? null]),
  }));
  return store.tx(() => {
    const previous = store.settings.get(key);
    const existing = previous ? store.threads.get(previous) : undefined;
    const archive = existing ? store.threads.context(existing.id).archived_conversation : undefined;
    if (
      existing &&
      (!archive ||
        existing.project_id !== project ||
        archive.id !== id ||
        archive.branch !== chat.branch ||
        archive.source !== chat.source)
    )
      throw badRequest("conversation_conflict");
    const known = archive?.turns ?? [];
    if (known.slice(0, signed.length).some((t, i) => t.signature !== signed[i]?.signature))
      throw badRequest("conversation_conflict");
    const added = signed.slice(known.length);
    const last = added.at(-1)?.turn;
    if (!last) {
      if (existing) return { thread: existing.id, added: 0, created: false };
      throw badRequest("conversation_empty");
    }
    const thread =
      existing ??
      store.threads.create({
        kind: "loose",
        title: chat.title,
        project_id: project,
        agent_ids: [owner],
        at: chat.turns[0]?.at,
      });
    const imported = [...known];
    for (const { turn, signature } of added) {
      const message = store.messages.add({
        thread_id: thread.id,
        author:
          turn.role === "user"
            ? { kind: "user" }
            : turn.role === "assistant"
              ? { kind: "agent", id: thread.agent_ids[0] ?? owner }
              : { kind: "system" },
        parts: [{ type: "text", text: turn.text, imported_from: { source: chat.source, role: turn.role } }],
        quiet: true,
        ...(turn.role === "assistant" ? { model: chat.source } : {}),
        ...(turn.at ? { at: turn.at } : {}),
      });
      imported.push({ id: turn.id, role: turn.role, message: message.id, signature });
    }
    // Historical system instructions and tool output are visible, never promoted to native model instructions or calls.
    const history = newestImportedHistory(
      chat.turns.flatMap((t, i) =>
        t.role === "user" || t.role === "assistant" ? [{ index: i, role: t.role, content: t.text }] : [],
      ),
    )
      .filter((item) => item.index >= known.length)
      .map(({ role, content }) => ({ role, content }));
    if (history.length) store.modelLog.append(thread.id, undefined, history);
    store.threads.mergeContext(thread.id, {
      archived_conversation: { source: chat.source, id, branch: chat.branch, turns: imported },
    });
    store.threads.settle(thread.id, last.at ?? new Date().toISOString(), last.text.slice(0, 140));
    store.settings.set(key, thread.id);
    return { thread: thread.id, added: added.length, created: !existing };
  });
}
