import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "../domain/model-log.ts";
import { recapOf, notesBlock } from "./turn.ts";
import { COMPACT_AT_CHARS } from "./upkeep.ts";

const entry = (seq: number, content: string): LogEntry => ({ seq, run_id: "r", item: { role: "user", content } });

test("the task notebook rides on every owner turn; near the limit the agent is asked for a handoff (D-186)", () => {
  assert.equal(notesBlock({}, [entry(1, "hola")]), undefined);
  const small = notesBlock({ notebook: { text: "objetivo: X", at: "2026-11-10T10:00:00Z" } }, [entry(1, "hola")]);
  assert.match(small ?? "", /objetivo: X/);
  assert.doesNotMatch(small ?? "", /nearly full/);
  const big = notesBlock({}, [entry(1, "x".repeat(COMPACT_AT_CHARS))]);
  assert.match(big ?? "", /nearly full[\s\S]*task_notes/);
  // What was summarized already does not count.
  assert.equal(notesBlock({ compaction: { upto: 1, summary: "s", untrusted: false, runs: 1, at: "" } as never }, [entry(1, "x".repeat(COMPACT_AT_CHARS))]), undefined);
});

test("a new Claude window starts from the summary, once, and the newest turns", () => {
  const summary = "## Goal\nhacer Y";
  const r = recapOf(
    [
      { role: "user", content: `[summary of the earlier conversation in this thread, written by Colonia when it got long]\n${summary}\n\nsigue` },
      { role: "assistant", content: "voy" },
    ],
    12_000,
    summary,
  );
  assert.match(r, /^Summary of this chat so far[\s\S]*hacer Y/);
  assert.equal(r.split("hacer Y").length, 2);
  assert.match(r, /User: sigue\n\nYou: voy/);
});
