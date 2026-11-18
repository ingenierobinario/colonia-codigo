import type { ConversationExportError, ExportConversation } from "@colonia/protocol/conversation-export";

export type FileIssue = ConversationExportError["code"] | "read";
export type ChatSummary = Pick<ExportConversation, "source" | "title" | "id" | "branch"> & {
  turns: number;
  excerpt: string;
  currentBranch: boolean;
  note: boolean;
};
export type FileRequest = { file: File; selected?: number[]; cowork?: boolean };
export type FileReply =
  | { summaries: ChatSummary[]; omitted: number }
  | { conversations: ExportConversation[] }
  | { issue: FileIssue };

/** El diálogo procesa un archivo cada vez. El lector reutiliza el mismo módulo hasta cerrar la ventana. */
export function conversationFileReader() {
  let worker: Worker | undefined;
  function close() {
    worker?.terminate();
    worker = undefined;
  }
  async function read(request: FileRequest, signal: AbortSignal): Promise<FileReply> {
    signal.throwIfAborted();
    worker ??= new Worker(new URL("./conversation-file.worker.ts", import.meta.url), {
      type: "module",
    });
    const active = worker;
    return new Promise((resolve, reject) => {
      const finished = () => {
        active.onmessage = null;
        active.onerror = null;
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        finished();
        close();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      active.onmessage = (event: MessageEvent<FileReply>) => {
        finished();
        resolve(event.data);
      };
      active.onerror = () => {
        finished();
        close();
        resolve({ issue: "read" });
      };
      active.postMessage(request);
    });
  }
  return { read, close };
}
