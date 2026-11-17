// ROUTER-CLAUDE-1: Claude con la cuenta se ofrece donde el núcleo lo acepta, y sus negativas se leen sin jerga.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEngine } from "@colonia/protocol";
import { startI18n } from "../i18n/index.ts";
import { prefs } from "./prefs.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const { forAgents, modelErrorText } = await import("./models.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);

const engine = (o: Partial<CatalogEngine> & { id: string }): CatalogEngine =>
  ({ label: o.id, models: [], available: true, ...o }) as unknown as CatalogEngine;

const catalog = [
  engine({ id: "claude", label: "Claude Code", kind: "harness" } as Partial<CatalogEngine> & { id: string }),
  engine({ id: "codex", label: "Codex", kind: "harness" } as Partial<CatalogEngine> & { id: string }),
];

test("Claude con cuenta se ofrece a agentes y router salvo apagado; Codex no", () => {
  assert.equal(forAgents(engine({ id: "claude", kind: "harness" } as never)), true);
  assert.equal(forAgents(engine({ id: "claude", kind: "harness", for_agents: true } as never)), true);
  assert.equal(forAgents(engine({ id: "claude", kind: "harness", for_agents: false } as never)), false);
  assert.equal(forAgents(engine({ id: "claude", kind: "harness", available: false } as never)), false);
  assert.equal(forAgents(engine({ id: "codex", kind: "harness" } as never)), false);
  assert.equal(forAgents(engine({ id: "anthropic", kind: "provider" } as never)), true);
});

const core = {
  off: "Claude with your account is switched off: turn it on in Settings › Engines and models",
  cli: "codex works only in its own chats (Sessions › codex), not in agents or the router",
  legacy: "claude runs only in its own sessions; pick a model API",
  session: "this chat is a codex session: pick a codex model",
  unknown: "unknown engine: foo",
  pick: "say which claude model",
};

test("en español, las negativas del núcleo sin jerga", async () => {
  prefs.set({ language: "es" });
  await startI18n();
  assert.match(modelErrorText(new Error(core.off), catalog), /apagado/);
  assert.match(modelErrorText(new Error(core.cli), catalog), /^Codex solo funciona en sus propias conversaciones/);
  assert.match(modelErrorText(new Error(core.legacy), catalog), /^Claude Code solo funciona/);
  assert.match(modelErrorText(new Error(core.session), catalog), /es de Codex/);
  assert.match(modelErrorText(new Error(core.unknown), catalog), /ya no está disponible/);
  assert.match(modelErrorText(new Error(core.pick), catalog), /modelo de Claude Code/);
  assert.equal(modelErrorText(new Error("otra cosa"), catalog), "otra cosa");
  for (const raw of Object.values(core))
    assert.doesNotMatch(modelErrorText(new Error(raw), catalog), /session|harness|engine/i);
});

test("en inglés, igual de claras", async () => {
  prefs.set({ language: "en" });
  await startI18n();
  assert.match(modelErrorText(new Error(core.off), catalog), /turned off/i);
  assert.match(modelErrorText(new Error(core.cli), catalog), /^Codex /);
  assert.doesNotMatch(modelErrorText(new Error(core.cli), catalog), /harness/);
});
