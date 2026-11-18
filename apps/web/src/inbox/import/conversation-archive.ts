import {
  CONVERSATION_FILE_BYTES,
  ConversationExportError,
  parseConversationExport,
  parseCoworkNote,
} from "@colonia/protocol/conversation-export";
import { BlobReader, type FileEntry, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";

const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 32_000;
const ignoredFolders = new Set([
  "__macosx",
  ".git",
  "assets",
  "attachments",
  "uploads",
  "files",
  "user_files",
  "artifacts",
  "credentials",
  "memories",
  "settings",
  "node_modules",
]);

// El directorio del ZIP se consulta por rangos. Las fotos y demás adjuntos pueden ser mucho más grandes.
class ArchiveReader extends BlobReader {
  override async readUint8Array(index: number, length: number) {
    if (length > MAX_DIRECTORY_BYTES) throw new ConversationExportError("limit");
    return super.readUint8Array(index, length);
  }
}

function isTranscript(path: string) {
  const pieces = path.replaceAll("\\", "/").split("/");
  if (pieces.some((p) => !p || p === ".." || p === "." || p.includes("\0"))) return false;
  const name = pieces.pop();
  if (!name) return false;
  if (pieces.some((p) => ignoredFolders.has(p.toLowerCase()))) return false;
  if (pieces.length <= 1 && /^conversations(?:[-_]?\d+)?\.json$/i.test(name)) return true;
  return (
    /^(?:transcript|session|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i.test(name) ||
    (pieces.at(-1)?.toLowerCase() === "subagents" && /^agent-[a-z0-9-]+\.jsonl$/i.test(name))
  );
}

async function readText(entry: FileEntry) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      bytes += chunk.byteLength;
      if (bytes > entry.uncompressedSize || bytes > CONVERSATION_FILE_BYTES) throw new ConversationExportError("limit");
      parts.push(decoder.decode(chunk, { stream: true }));
    },
  });
  await entry.getData(writer, { checkSignature: true, checkOverlappingEntry: true });
  if (bytes !== entry.uncompressedSize) throw new ConversationExportError("structure");
  parts.push(decoder.decode());
  return parts.join("");
}

export async function readConversationSelection(
  file: File,
  cowork = false,
): Promise<ReturnType<typeof parseConversationExport>> {
  const options = cowork ? { source: "cowork" as const } : undefined;
  if (!/\.zip$/i.test(file.name)) {
    if (file.size > CONVERSATION_FILE_BYTES) throw new ConversationExportError("limit");
    const text = await file.text();
    if (/\.(?:md|txt)$/i.test(file.name)) return parseCoworkNote(text, file.name);
    return parseConversationExport(text, options);
  }
  const zip = new ZipReader(new ArchiveReader(file), { useWebWorkers: false });
  try {
    const names = new Set<string>();
    const result: ReturnType<typeof parseConversationExport> = { conversations: [], omitted: 0 };
    let entries = 0;
    let inputBytes = 0;
    let outputBytes = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      if (++entries > MAX_ENTRIES) throw new ConversationExportError("limit");
      if (entry.directory || entry.symlink || !isTranscript(entry.filename)) continue;
      if (names.has(entry.filename) || entry.encrypted) throw new ConversationExportError("structure");
      names.add(entry.filename);
      inputBytes += entry.uncompressedSize;
      if (inputBytes > CONVERSATION_FILE_BYTES) throw new ConversationExportError("limit");
      const text = await readText(entry);
      try {
        const parsed = parseConversationExport(text, options);
        for (const chat of parsed.conversations) {
          outputBytes += new Blob([JSON.stringify(chat)]).size;
          if (outputBytes > CONVERSATION_FILE_BYTES) throw new ConversationExportError("limit");
          result.conversations.push(chat);
        }
        result.omitted += parsed.omitted;
      } catch (err) {
        if (!(err instanceof ConversationExportError && err.code === "empty")) throw err;
        result.omitted++;
      }
    }
    if (!result.conversations.length) throw new ConversationExportError(names.size ? "empty" : "format");
    return result;
  } catch (err) {
    if (err instanceof ConversationExportError) throw err;
    throw new ConversationExportError("structure");
  } finally {
    await zip.close();
  }
}
