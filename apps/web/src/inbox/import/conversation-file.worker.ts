import { ConversationExportError } from "@colonia/protocol/conversation-export";
import { readConversationSelection } from "./conversation-archive.ts";
import type { FileReply, FileRequest } from "./conversation-file.ts";

function excerpt(text: string): string {
  return text.length <= 160 ? text : `${text.slice(0, 160).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

self.onmessage = async ({ data }: MessageEvent<FileRequest>) => {
  let reply: FileReply;
  try {
    const { conversations, omitted } = await readConversationSelection(data.file, data.cowork);
    if (data.selected) {
      const selected = new Set(data.selected);
      reply = { conversations: conversations.filter((_, i) => selected.has(i)) };
    } else {
      const counts = new Map<string, number>();
      for (const chat of conversations) {
        const key = `${chat.source}:${chat.id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      reply = {
        summaries: conversations.map(({ source, id, branch, current, kind, title, turns }) => ({
          source,
          note: kind === "note",
          id,
          branch,
          currentBranch: current === true && (counts.get(`${source}:${id}`) ?? 0) > 1,
          title,
          turns: turns.length,
          excerpt: excerpt((turns.find((turn) => turn.role === "user") ?? turns[0])?.text ?? ""),
        })),
        omitted,
      };
    }
  } catch (error) {
    reply = { issue: error instanceof ConversationExportError ? error.code : "read" };
  }
  self.postMessage(reply);
};
