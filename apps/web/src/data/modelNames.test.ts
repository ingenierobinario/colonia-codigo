// NOMBRE-MODELO-1: a model is shown under a name people can read, never as its raw "engine/model" ref.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEngine } from "@colonia/protocol";
import { listedName, modelLabel, modelName, readableModelId } from "./modelNames.ts";

const engine = (id: string, label: string, models: [string, string][]): CatalogEngine =>
  ({ id, label, models: models.map(([mid, name]) => ({ id: mid, name, chat: true })) }) as unknown as CatalogEngine;

const catalog = [
  engine("anthropic", "Anthropic", [
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["claude-haiku-5-5", "claude-haiku-5-5"],
  ]),
  engine("codex", "Codex", [["gpt-6-sol", "GPT-6 Sol"]]),
  engine("openrouter", "OpenRouter", [["claude-opus-5-5", "Claude Opus 5.5"]]),
];

test("un id de modelo se lee como un nombre", () => {
  assert.equal(readableModelId("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(readableModelId("gpt-6-sol"), "GPT 6 Sol");
  assert.equal(readableModelId("claude-sonnet-5-20260101"), "Claude Sonnet 5 20260101");
  assert.equal(readableModelId("llama3.3"), "Llama3.3");
});

test("el nombre sale del catálogo, y del id si el catálogo no da uno", () => {
  assert.equal(modelName("codex/gpt-6-sol", catalog), "GPT-6 Sol");
  assert.equal(modelName("anthropic/claude-haiku-5-5", catalog), "Claude Haiku 5.5");
  assert.equal(modelName("otro/mi-modelo-2", catalog), "Mi Modelo 2");
  assert.equal(modelName("anthropic/claude-opus-5-5", []), "Claude Opus 5.5");
});

test("la etiqueta de un modelo nunca es su referencia en crudo", () => {
  assert.equal(modelLabel("codex/gpt-6-sol", catalog), "GPT-6 Sol");
  assert.equal(modelLabel("anthropic/claude-opus-5-5", []), "Claude Opus 5.5");
  for (const ref of ["anthropic/claude-opus-5-5", "codex/gpt-6-sol", "otro/mi-modelo-2"]) {
    assert.ok(!modelLabel(ref, catalog).includes("/"), ref);
  }
});

test("el motor se nombra solo cuando otro motor ofrece el mismo modelo", () => {
  assert.equal(modelLabel("anthropic/claude-opus-5-5", catalog), "Claude Opus 5.5 (Anthropic)");
  assert.equal(modelLabel("openrouter/claude-opus-5-5", catalog), "Claude Opus 5.5 (OpenRouter)");
  assert.equal(modelLabel("anthropic/claude-haiku-5-5", catalog), "Claude Haiku 5.5");
});

test("en una lista, un modelo sin nombre propio se lee por su id en palabras", () => {
  assert.equal(listedName({ id: "claude-opus-5-5", name: "claude-opus-5-5" }), "Claude Opus 5.5");
  assert.equal(listedName({ id: "gpt-6-sol", name: "GPT-6 Sol" }), "GPT-6 Sol");
});
