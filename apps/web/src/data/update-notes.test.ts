import assert from "node:assert/strict";
import { test } from "node:test";
import { firstNote, notesFor } from "./update-notes.ts";

const localized = {
  en: ["Projects have pictures.", "Closed tasks reopen."],
  es: ["Los proyectos llevan imagen.", "Las tareas cerradas se reabren."],
};

test("a release that says its notes per language shows them in the language on screen", () => {
  assert.deepEqual(notesFor(localized, localized.en, "es"), localized.es);
  assert.deepEqual(notesFor(localized, localized.en, "en"), localized.en);
  assert.equal(firstNote(localized, localized.en, "es"), "Los proyectos llevan imagen.");
  assert.equal(firstNote(localized, localized.en, "en"), "Projects have pictures.");
});

test("a release from before notes per language shows its lines as they were written", () => {
  assert.deepEqual(notesFor(undefined, ["Better updates", "Faster start"], "es"), ["Better updates", "Faster start"]);
  assert.deepEqual(notesFor({ en: ["Only English"] }, ["Only English"], "es"), ["Only English"]);
  assert.deepEqual(notesFor({}, undefined, "en"), []);
});

test("several releases at once list no more than four lines", () => {
  const many = { es: ["uno", "dos", "tres", "cuatro", "cinco", "seis"] };
  assert.deepEqual(notesFor(many, [], "es"), ["uno", "dos", "tres", "cuatro"]);
});

test("the one line of a small notice skips a line that only names the version", () => {
  assert.equal(firstNote(undefined, ["Colonia 2.26.0", "Faster start"], "en"), "Faster start");
  assert.equal(firstNote(undefined, ["Colonia 2.26.0"], "en"), undefined);
  assert.equal(firstNote(undefined, [], "es"), undefined);
});
