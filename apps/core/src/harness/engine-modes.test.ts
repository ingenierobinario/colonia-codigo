// ULTRACODE-1 / VELOCIDAD-1: los modos propios de cada motor viajan en la referencia del modelo y llegan a su arranque.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRef } from "../domain/refs.ts";
import { fromCodexList } from "../models/catalog.ts";
import { claudeSettings } from "./claude.ts";
import { hasMode } from "./types.ts";

test("a ref carries its effort and its modes apart", () => {
  assert.deepEqual(parseRef("claude/opus#high+ultracode"), {
    engine: "claude",
    model: "opus",
    effort: "high",
    modes: ["ultracode"],
  });
  assert.deepEqual(parseRef("codex/gpt-6-sol#+fast"), { engine: "codex", model: "gpt-6-sol", modes: ["fast"] });
  assert.deepEqual(parseRef("codex/gpt-6-sol#high"), { engine: "codex", model: "gpt-6-sol", effort: "high" });
  assert.equal(hasMode("claude/opus#+ultracode", "ultracode"), true);
  assert.equal(hasMode("claude/opus#high", "ultracode"), false);
});

test("Claude Code gets ultracode in its session settings only when the ref asks for it", () => {
  assert.equal(claudeSettings(true).ultracode, true);
  assert.equal("ultracode" in claudeSettings(false), false);
  assert.equal(claudeSettings(true).disableClaudeAiConnectors, true);
});

test("only the Codex CLI's models offer fast mode, and only those that list it", () => {
  const listed = [
    { slug: "gpt-a", additional_speed_tiers: ["fast"] },
    { slug: "gpt-b", additional_speed_tiers: [] },
  ];
  assert.deepEqual(
    fromCodexList(listed, true).map((m) => [m.id, m.modes]),
    [
      ["gpt-a", ["fast"]],
      ["gpt-b", undefined],
    ],
  );
  assert.deepEqual(
    fromCodexList(listed).map((m) => m.modes),
    [undefined, undefined],
  );
});
