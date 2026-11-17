import assert from "node:assert/strict";
import { test } from "node:test";
import { en, type MessageKey } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { BOTS, type BotKind } from "./botFields.ts";
import { guideOf } from "./botGuide.ts";

const KINDS = Object.keys(BOTS) as BotKind[];

test("el asistente de cada canal pide todos sus datos, uno por pantalla y ninguno dos veces", () => {
  for (const kind of KINDS) {
    const asked = guideOf(kind).flatMap((s) => s.fields ?? []);
    assert.deepEqual(
      [...asked].sort(),
      BOTS[kind].tokens.map((_, i) => i),
      kind,
    );
  }
});

test("cada paso tiene su texto en inglés y en español", () => {
  for (const kind of KINDS)
    for (const step of guideOf(kind))
      for (const key of [step.text, step.see].filter((k): k is MessageKey => k !== undefined)) {
        assert.ok((en as Record<string, string>)[key], `${kind}: ${key} en inglés`);
        assert.ok(es[key], `${kind}: ${key} en español`);
      }
});

test("Telegram abre BotFather, copia /newbot y pide el mensaje en el último paso", () => {
  const g = guideOf("telegram");
  assert.equal(g[0]?.open, "start");
  assert.equal(g[1]?.copy, "/newbot");
  assert.deepEqual(g.at(-1)?.fields, [0]);
});

test("un canal sin guía propia tiene una pantalla por paso y abre su web en la primera", () => {
  const g = guideOf("line");
  assert.equal(g.length, BOTS.line.steps.length);
  assert.equal(g[0]?.open, "start");
});
