import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationExportError } from "@colonia/protocol/conversation-export";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { readConversationSelection } from "./conversation-archive.ts";

// ZIP creado con zipfile de Python, como un archivo de proveedor con dos partes y datos de cuenta.
const official = Buffer.from(
  "UEsDBBQAAAAIABZ/cl0a0UsUlAAAAPUAAAAdAAAAZXhwb3J0L2NvbnZlcnNhdGlvbnMtMDAwLmpzb25NjtEKwzAIRX9FfO5+IP8w2HspI1slzUhNMAY2Sv992K6sPum9eo/9gnFEB1gkziQeO0CNmsi021+bfSmRAzpYMLO5x6FNHWDxQqzogFtKHeBzimkUYnTQDxZAtfpwPpxruJyovumUZfMl7/xWSXC1sMy6py9Hf9dP2ZaU3vp7QKvR8Epc/YtgJCjS6OHhwAyr1fAFUEsDBBQAAAAIABZ/cl2jjwxNlAAAAPUAAAAdAAAAZXhwb3J0L2NvbnZlcnNhdGlvbnMtMDAxLmpzb25NjkEKwzAMBL8idE4/4D/01GMwxa2F4+LIxpahJeTvRUlDo5O0K+1oXDB6NICNQmfvcACUKIlUu/212ZUSOaCBBTOrexzqNAAWV4kFDXBPaQB8TjH5SowGRqsB1JoL58O5hcuJ6rpMuW5+zTu/N6q4alhm2dOXo7/Lp2xLQm/5PSBNaXglbu5F4AlK7fRwcGDsqmW/UEsDBBQAAAAIABZ/cl1hZC8IJAAAACIAAAAQAAAAZXhwb3J0L3VzZXIuanNvbqtWSs1NzMxRslJQykzPyy9KTMl3SK1IzC3ISdUrSS0uUaoFAFBLAwQUAAAACAAWf3JdlaNBxiYAAAAkAAAAFwAAAGV4cG9ydC9maWxlcy9vdHJvLmpzb25sq1ZKS8xOVbJSUEosSs7ILMtXSEzJKs0ryVfITM/LL0pMyVeqBQBQSwMEFAAAAAgAFn9yXdIqRo4hAAAAHwAAABAAAABleHBvcnQvY2hhdC5odG1sU7IpsHMtLklVSCxKzsgsy1coTlXIz80sSdWz0S+wUwIAUEsBAhQAFAAAAAgAFn9yXRrRSxSUAAAA9QAAAB0AAAAAAAAAAAAAAIABAAAAAGV4cG9ydC9jb252ZXJzYXRpb25zLTAwMC5qc29uUEsBAhQAFAAAAAgAFn9yXaOPDE2UAAAA9QAAAB0AAAAAAAAAAAAAAIABzwAAAGV4cG9ydC9jb252ZXJzYXRpb25zLTAwMS5qc29uUEsBAhQAFAAAAAgAFn9yXWFkLwgkAAAAIgAAABAAAAAAAAAAAAAAAIABngEAAGV4cG9ydC91c2VyLmpzb25QSwECFAAUAAAACAAWf3JdlaNBxiYAAAAkAAAAFwAAAAAAAAAAAAAAgAHwAQAAZXhwb3J0L2ZpbGVzL290cm8uanNvbmxQSwECFAAUAAAACAAWf3Jd0ipGjiEAAAAfAAAAEAAAAAAAAAAAAAAAgAFLAgAAZXhwb3J0L2NoYXQuaHRtbFBLBQYAAAAABQAFAFcBAACaAgAAAAA=",
  "base64",
);
const jsonl = JSON.stringify({
  type: "user",
  uuid: "turno-1",
  sessionId: "sesion-prueba",
  parentUuid: null,
  message: { role: "user", content: "Hola desde Cowork" },
});
async function zipped(names: [string, string][]) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, value] of names) await writer.add(name, new TextReader(value), { level: 0 });
  return new File([await writer.close()], "sesiones.zip");
}
function error(code: string) {
  return (err: unknown) => err instanceof ConversationExportError && err.code === code;
}

test("lee las partes de la exportación ZIP en el mismo orden en la vista previa y la confirmación", async () => {
  const file = new File([official], "exportación.ZIP");
  const first = await readConversationSelection(file);
  assert.deepEqual(
    first.conversations.map((c) => [c.source, c.title]),
    [
      ["chatgpt", "Primera"],
      ["chatgpt", "Segunda"],
    ],
  );
  assert.equal(first.omitted, 0);
  assert.deepEqual(await readConversationSelection(file), first);
});
test("lee transcripciones reconocidas en un ZIP de tarea y conserva la elección de Cowork", async () => {
  const file = await zipped([
    ["tarea/transcript.jsonl", jsonl],
    ["settings.json", "{}"],
    ["tarea/credentials.jsonl", jsonl],
  ]);
  const parsed = await readConversationSelection(file, true);
  assert.equal(parsed.conversations.length, 1);
  assert.equal(parsed.conversations[0]?.source, "cowork");
  assert.equal(parsed.conversations[0]?.turns[0]?.text, "Hola desde Cowork");
});
test("un ZIP sin historiales reconocidos se explica sin importar sus datos de cuenta", async () => {
  const file = await zipped([
    ["settings.json", jsonl],
    ["uploads/conversations.json", "{}"],
    ["export/credentials.jsonl", jsonl],
  ]);
  await assert.rejects(readConversationSelection(file), error("format"));
});
test("rechaza un ZIP dañado antes de devolver una importación parcial", async () => {
  const copy = Buffer.from(official);
  const start = copy.readUInt16LE(26) + copy.readUInt16LE(28) + 30;
  copy.writeUInt8(copy.readUInt8(start + 5) ^ 0x80, start + 5);
  await assert.rejects(readConversationSelection(new File([copy], "rota.zip")), error("structure"));
});
test("limita lo que se descomprime de los historiales y omite adjuntos grandes", async () => {
  const changed = Buffer.from(official);
  const header = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const item = (archive: Buffer, name: string) => {
    let i = archive.indexOf(header);
    while (i >= 0) {
      const n = archive.readUInt16LE(i + 28);
      if (archive.toString("utf8", i + 46, i + 46 + n) === name) return i;
      i = archive.indexOf(header, i + 46 + n);
    }
    throw new Error(name);
  };
  changed.writeUInt32LE(512 * 1024 * 1024, item(changed, "export/files/otro.jsonl") + 24);
  assert.equal((await readConversationSelection(new File([changed], "adjuntos.zip"))).conversations.length, 2);
  changed.writeUInt32LE(512 * 1024 * 1024, item(changed, "export/conversations-001.json") + 24);
  await assert.rejects(readConversationSelection(new File([changed], "limite.zip")), error("limit"));
});
test("la entrada JSONL seleccionada fuera del ZIP mantiene su formato original", async () => {
  const cp = await readConversationSelection(new File([jsonl], "sesion.jsonl"));
  assert.equal(cp.conversations[0]?.source, "claude-code");
});

test("la persona puede elegir un resumen Markdown de Cowork sin atribuirle interlocutores", async () => {
  const value = "Objetivo de la tarea\n\nDecidimos revisar las cuentas mañana.";
  const file = new File([value], "Resumen de la tarea.md");
  const parsed = await readConversationSelection(file);
  assert.equal(parsed.conversations[0]?.kind, "note");
  assert.equal(parsed.conversations[0]?.source, "cowork");
  assert.deepEqual(
    parsed.conversations[0]?.turns.map((t) => [t.role, t.text]),
    [["note", value]],
  );
  const archive = await zipped([["Resumen de la tarea.md", value]]);
  await assert.rejects(readConversationSelection(archive, true), error("format"));
});
