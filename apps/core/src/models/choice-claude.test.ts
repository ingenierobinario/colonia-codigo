import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineIds } from "../domain/refs.ts";
import { recapOf } from "../engine/turn.ts";
import { refProblem } from "./choice.ts";

const engines = { harness: new Set(["claude", "codex"]), providers: new Set(["openai"]) } as unknown as EngineIds;

test("an agent may pick a Claude model; the router and the default may not (D-185)", () => {
  assert.equal(refProblem("claude/sonnet", engines, undefined, true), undefined);
  assert.match(refProblem("claude/sonnet", engines) ?? "", /own sessions/);
  assert.match(refProblem("codex/gpt-5", engines, undefined, true) ?? "", /own sessions/);
  assert.match(refProblem("claude/sonnet", engines, "codex", true) ?? "", /codex session/);
});

test("a fresh Claude session gets the chat so far, newest kept when it is long", () => {
  assert.equal(recapOf([]), "");
  const r = recapOf([
    { role: "user", content: "hola" },
    { role: "assistant", content: "qué tal" },
  ] as never);
  assert.match(r, /User: hola\n\nYou: qué tal$/);
  const long = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `${i} ${"x".repeat(1000)}` }));
  const cut = recapOf(long as never);
  assert.ok(cut.includes("User: 49 ") && !cut.includes("User: 0 "));
});
