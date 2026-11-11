import assert from "node:assert/strict";
import { test } from "node:test";
import { firstHighlight, updateNotice } from "./update-notes.ts";

const localized = {
  en: ["Each project can have its own picture.", "Closed tasks can be reopened."],
  es: ["Cada proyecto puede llevar su propia imagen.", "Las tareas cerradas se pueden reabrir."],
};

test("the notification names the version and the first thing it brings, in the person's language", () => {
  assert.deepEqual(updateNotice("out", "2.27.0", true, { localized }), {
    title: "Salió Colonia 2.27.0",
    body: "Cada proyecto puede llevar su propia imagen. Abre Colonia para actualizar.",
  });
  assert.deepEqual(updateNotice("out", "2.27.0", false, { localized }), {
    title: "Colonia 2.27.0 is out",
    body: "Each project can have its own picture. Open Colonia to update.",
  });
  assert.deepEqual(updateNotice("ready", "2.27.0", true, { localized }), {
    title: "Colonia 2.27.0 está lista",
    body: "Cada proyecto puede llevar su propia imagen. Reinicia Colonia para usarla.",
  });
  assert.deepEqual(updateNotice("ready", "2.27.0", false, { localized }), {
    title: "Colonia 2.27.0 is ready",
    body: "Each project can have its own picture. Restart Colonia to use it.",
  });
});

test("a release from before notes per language is told as it was written; one with nothing still says what to do", () => {
  assert.equal(
    updateNotice("out", "2.26.0", true, { notes: ["Better updates"] }).body,
    "Better updates. Abre Colonia para actualizar.",
  );
  assert.equal(updateNotice("out", "2.26.0", true, { notes: [] }).body, "Abre Colonia para actualizar.");
  assert.equal(updateNotice("ready", "2.26.0", false).body, "Restart Colonia to use it.");
  // A release that says its notes in one language only: the other falls back to the plain lines.
  assert.equal(firstHighlight(true, { notes: ["Plain line"], localized: { en: ["Only English"] } }), "Plain line.");
});

test("a line that only names the version is skipped", () => {
  assert.equal(firstHighlight(false, { notes: ["Colonia 2.26.0", "Faster start"] }), "Faster start.");
  assert.equal(firstHighlight(false, { notes: ["Colonia 2.26.0"] }), undefined);
});

test("a long highlight is cut at a word, so the notification keeps its closing sentence", () => {
  const long = `${"word ".repeat(40).trim()}.`;
  const short = firstHighlight(false, { notes: [long] });
  assert.ok(short);
  assert.ok(short.length <= 121, String(short.length));
  assert.match(short, /word…$/);
  assert.match(updateNotice("out", "2.27.0", false, { notes: [long] }).body, /word… Open Colonia to update\.$/);
});
