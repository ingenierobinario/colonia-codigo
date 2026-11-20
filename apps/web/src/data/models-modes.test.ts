// ULTRACODE-1 / VELOCIDAD-1: el selector guarda el modo del motor en la referencia, junto al effort, sin perder ninguno.
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitRef } from "./modelNames.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const { withEffort, withMode } = await import("./models.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);

test("switching a mode on and off keeps the effort, and changing the effort keeps the mode", () => {
  const on = withMode("claude/opus#high", "ultracode", true);
  assert.equal(on, "claude/opus#high+ultracode");
  assert.deepEqual(splitRef(on), { engine: "claude", model: "opus", effort: "high", modes: ["ultracode"] });
  assert.equal(withEffort(on, "low"), "claude/opus#low+ultracode");
  assert.equal(withEffort(on, undefined), "claude/opus#+ultracode");
  assert.equal(withMode("claude/opus#+ultracode", "ultracode", false), "claude/opus");
  assert.equal(withMode("codex/gpt-6-sol", "fast", true), "codex/gpt-6-sol#+fast");
});
