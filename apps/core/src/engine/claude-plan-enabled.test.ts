// CLAUDE-ACTIVO-1: con el plan de Claude apagado en Ajustes, un agente que eligió un modelo de Claude no corre en él.
import assert from "node:assert/strict";
import { test } from "node:test";
import { enginePick } from "./turn.ts";

const fake = (enabled: boolean | undefined, chain: string[] = [], router = false) => {
  const settings = new Map<string, unknown>([
    ["model_default", undefined],
    ["model_router", { rules: [], chain }],
    ...(enabled === undefined ? [] : ([["claude_plan_enabled", enabled]] as const)),
  ]);
  const deps = {
    store: {
      threads: { context: () => ({}) },
      settings: { read: (k: string) => (settings.has(k) ? settings.get(k) : true) },
    },
  };
  const turn = {
    thread: { id: "t1" },
    agent: { model_choice: { model: "claude/sonnet", router } },
    input: { text: "hola" },
  };
  // biome-ignore lint/suspicious/noExplicitAny: only the fields enginePick reads before the Claude branch
  return () => enginePick(deps as any, turn as any, {} as any, []);
};

test("the Claude plan runs an agent while it is on, and by default (saved data without the setting)", () => {
  assert.deepEqual(fake(undefined)(), { harness: "claude", refs: ["claude/sonnet"], fallback: [] });
  assert.deepEqual(fake(true)(), { harness: "claude", refs: ["claude/sonnet"], fallback: [] });
  // With the router behind it, its API models are the fallback.
  assert.deepEqual(fake(true, ["openai/x"], true)(), {
    harness: "claude",
    refs: ["claude/sonnet"],
    fallback: ["openai/x"],
  });
});

test("switched off, Colonia does not run an agent on the Claude plan", () => {
  assert.throws(fake(false), /switched off/);
  // With the router behind it, the API models answer instead.
  assert.deepEqual(fake(false, ["claude", "openai/x"], true)(), { harness: "native", refs: ["openai/x"] });
});
