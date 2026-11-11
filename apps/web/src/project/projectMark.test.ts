import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_ICONS, ProjectMark } from "@colonia/protocol";
import { PROJECT_GLYPHS } from "@colonia/ui/project-glyphs";
import { draftOf, firstGrapheme, markOf, PICTURE_SOURCE_BYTES, PROJECT_EMOJIS, pictureProblem } from "./projectMark.ts";

test("every icon a project can carry has a glyph, and no glyph is left without a name", () => {
  assert.deepEqual(Object.keys(PROJECT_GLYPHS).sort(), [...PROJECT_ICONS].sort());
  for (const id of PROJECT_ICONS) assert.ok(PROJECT_GLYPHS[id], id);
});

test("a tile opens in the mode it was saved in", () => {
  assert.equal(draftOf(undefined).mode, "letter");
  assert.equal(draftOf({ tone: "ink" }).mode, "letter");
  assert.equal(draftOf({ emoji: "🚀" }).mode, "emoji");
  assert.equal(draftOf({ icon: "rocket", tone: "violet" }).mode, "icon");
  assert.equal(draftOf({ image: "m_1" }).mode, "picture");
});

test("what is saved is one drawing at most, with the colour only when one was chosen", () => {
  const base = draftOf({ icon: "rocket", tone: "violet" });
  assert.deepEqual(markOf(base), { icon: "rocket", tone: "violet" });
  assert.deepEqual(markOf({ ...base, mode: "emoji", emoji: "🎯" }), { emoji: "🎯", tone: "violet" });
  assert.deepEqual(markOf({ ...base, mode: "emoji", emoji: "🎯", tone: undefined }), { emoji: "🎯" });
  assert.deepEqual(markOf({ ...base, mode: "picture" }, "m_9"), { image: "m_9", tone: "violet" });
  assert.deepEqual(markOf({ ...base, mode: "letter" }), { tone: "violet" });
});

test("the plain initial in its own colour saves nothing", () => {
  assert.equal(markOf(draftOf(undefined)), null);
  assert.equal(markOf({ ...draftOf({ emoji: "🚀" }), mode: "letter" }), null);
  // A mode with nothing chosen in it falls back to the initial rather than saving half a mark.
  assert.equal(markOf({ ...draftOf(undefined), mode: "emoji" }), null);
  assert.equal(markOf({ ...draftOf(undefined), mode: "picture" }), null);
});

test("every mark the editor can save is one the core accepts", () => {
  for (const emoji of PROJECT_EMOJIS) {
    assert.equal(firstGrapheme(emoji), emoji);
    assert.equal(ProjectMark.safeParse(markOf({ ...draftOf(undefined), mode: "emoji", emoji })).success, true, emoji);
  }
  assert.equal(new Set(PROJECT_EMOJIS).size, PROJECT_EMOJIS.length);
});

test("typed text is cut to its first character, counting a flag or a family as one", () => {
  assert.equal(firstGrapheme("  ab"), "a");
  assert.equal(firstGrapheme("🚀🔥"), "🚀");
  assert.equal(firstGrapheme("🇪🇸🇫🇷"), "🇪🇸");
  assert.equal(firstGrapheme("👨‍👩‍👧 home"), "👨‍👩‍👧");
  assert.equal(firstGrapheme("   "), "");
});

test("a file that is not a picture, or is far too large to read, is refused with its reason", () => {
  assert.equal(pictureProblem({ type: "image/png", size: 10 }), undefined);
  assert.equal(pictureProblem({ type: "image/gif", size: PICTURE_SOURCE_BYTES }), undefined);
  assert.equal(pictureProblem({ type: "application/pdf", size: 10 }), "type");
  assert.equal(pictureProblem({ type: "image/svg+xml", size: 10 }), "type");
  assert.equal(pictureProblem({ type: "image/jpeg", size: PICTURE_SOURCE_BYTES + 1 }), "size");
});
