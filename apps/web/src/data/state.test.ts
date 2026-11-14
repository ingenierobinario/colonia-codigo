import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@colonia/protocol";
import { upsertMessage } from "./state.ts";

const message = (id: string, seq: number, text = id): Message => ({
  id,
  seq,
  thread_id: "thr_1",
  author: { kind: "user" },
  parts: [{ type: "text", text }],
  created_at: "2026-01-01T00:00:00Z",
});

test("messages insert into sequence order without mutating the cached array", () => {
  const original = [message("first", 1), message("last", 3)];
  assert.deepEqual(upsertMessage(undefined, original[0] as Message), [original[0]]);
  const inserted = message("middle", 2);
  assert.deepEqual(
    upsertMessage(original, inserted).map((m) => m.id),
    ["first", "middle", "last"],
  );
  assert.deepEqual(
    original.map((m) => m.id),
    ["first", "last"],
  );
});

test("replayed messages replace existing ids once and follow their corrected sequence", () => {
  const original = [message("first", 1), message("second", 2)];
  const replacement = message("first", 3, "Corrected");
  const result = upsertMessage(original, replacement);
  assert.deepEqual(result, [original[1], replacement]);
  assert.deepEqual(original[0]?.parts, [{ type: "text", text: "first" }]);
  assert.deepEqual(upsertMessage(result, replacement), result);
});

// PERF-11: the chat's rows are memoized by their message, so this is what makes a word of the answer being written
// cost one row and not the whole chat.
test("a part written into one message leaves every other message of the chat the very same object", () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, seq: i, parts: [] }) as unknown as Message);
  const last = list[199] as Message;
  const next = upsertMessage(list, { ...last, parts: [{ type: "text", text: "a word more" }] } as Message);
  assert.equal(next.length, 200);
  assert.equal(next.filter((m, i) => m !== list[i]).length, 1);
  assert.notEqual(next[199], last);
});
