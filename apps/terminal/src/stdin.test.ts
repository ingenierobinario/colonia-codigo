import assert from "node:assert/strict";
import { test } from "node:test";
import { readStdin } from "./stdin.ts";

async function* chunks(...parts: Buffer[]) {
  for (const p of parts) yield p;
}

test("readStdin: un carácter multibyte partido entre dos trozos llega entero", async () => {
  const bytes = Buffer.from("año €", "utf8");
  // Corta en mitad de la «ñ» (2 bytes) y en mitad del «€» (3 bytes).
  const out = await readStdin(chunks(bytes.subarray(0, 2), bytes.subarray(2, 6), bytes.subarray(6)));
  assert.equal(out, "año €");
});

test("readStdin: respeta el tope de bytes", async () => {
  await assert.rejects(readStdin(chunks(Buffer.alloc(10)), 5), /exceeds 5 bytes/);
});
