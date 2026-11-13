import assert from "node:assert/strict";
import { test } from "node:test";
import { close, MAX_TABS, move, numbered, open, prune, show, step, type Tabs, tabsOf } from "./tabs.ts";

const tabs = (ids: string[], active = ids[0] ?? ""): Tabs => ({ ids, active });

test("a chat picked in the list takes the place of the active tab", () => {
  assert.deepEqual(show(tabs(["a", "b", "c"], "b"), "x"), tabs(["a", "x", "c"], "x"));
});

test("a chat that already has a tab is brought forward, not opened twice", () => {
  assert.deepEqual(show(tabs(["a", "b", "c"], "a"), "c"), tabs(["a", "b", "c"], "c"));
  assert.deepEqual(open(tabs(["a", "b", "c"], "a"), "c"), tabs(["a", "b", "c"], "c"));
});

test("showing the active tab again changes nothing", () => {
  const before = tabs(["a", "b"], "b");
  assert.equal(show(before, "b"), before);
});

test("the first chat on screen becomes the first tab", () => {
  assert.deepEqual(show(tabs([]), "a"), tabs(["a"], "a"));
});

test("with no active tab the chat is added at the end", () => {
  assert.deepEqual(show(tabs(["a", "b"], ""), "x"), tabs(["a", "b", "x"], "x"));
  assert.deepEqual(show(tabs(["a", "b"], "gone"), "x"), tabs(["a", "b", "x"], "x"));
});

test("a new tab opens right after the active one", () => {
  assert.deepEqual(open(tabs(["a", "b", "c"], "a"), "x"), tabs(["a", "x", "b", "c"], "x"));
  assert.deepEqual(open(tabs(["a", "b"], "b"), "x"), tabs(["a", "b", "x"], "x"));
  assert.deepEqual(open(tabs(["a", "b"], ""), "x"), tabs(["a", "b", "x"], "x"));
});

test("at the limit a new tab reuses the active one instead of growing", () => {
  const ids = Array.from({ length: MAX_TABS }, (_, i) => `t${i}`);
  const next = open(tabs(ids, "t3"), "x");
  assert.equal(next.ids.length, MAX_TABS);
  assert.equal(next.ids[3], "x");
  assert.equal(next.active, "x");
});

test("a chat made from a new-chat tab keeps the place of that tab", () => {
  const made = show(tabs(["a", "new:agent=main", "c"], "new:agent=main"), "th_1");
  assert.deepEqual(made, tabs(["a", "th_1", "c"], "th_1"));
});

test("closing the active tab hands over to the one on its right, or on its left at the end", () => {
  assert.deepEqual(close(tabs(["a", "b", "c"], "b"), "b"), tabs(["a", "c"], "c"));
  assert.deepEqual(close(tabs(["a", "b", "c"], "c"), "c"), tabs(["a", "b"], "b"));
  assert.deepEqual(close(tabs(["a"], "a"), "a"), tabs([], ""));
});

test("closing another tab leaves the active one alone", () => {
  assert.deepEqual(close(tabs(["a", "b", "c"], "c"), "a"), tabs(["b", "c"], "c"));
  const before = tabs(["a", "b"], "a");
  assert.equal(close(before, "zzz"), before);
});

test("deleted chats lose their tabs and the active one hands over", () => {
  const gone = new Set(["b", "c"]);
  assert.deepEqual(
    prune(tabs(["a", "b", "c", "d"], "b"), (id) => gone.has(id)),
    tabs(["a", "d"], "d"),
  );
  const before = tabs(["a", "d"], "a");
  assert.equal(
    prune(before, (id) => gone.has(id)),
    before,
  );
});

test("a dragged tab takes the place of the one it is dropped on", () => {
  assert.deepEqual(move(tabs(["a", "b", "c", "d"], "a"), "a", "c"), tabs(["b", "c", "a", "d"], "a"));
  assert.deepEqual(move(tabs(["a", "b", "c", "d"], "a"), "d", "b"), tabs(["a", "d", "b", "c"], "a"));
  const before = tabs(["a", "b"], "a");
  assert.equal(move(before, "a", "a"), before);
  assert.equal(move(before, "a", "zzz"), before);
});

test("next and previous go round at the ends", () => {
  assert.equal(step(tabs(["a", "b", "c"], "c"), 1), "a");
  assert.equal(step(tabs(["a", "b", "c"], "a"), -1), "c");
  assert.equal(step(tabs(["a", "b", "c"], "a"), 1), "b");
  assert.equal(step(tabs(["a", "b", "c"], ""), 1), "a");
  assert.equal(step(tabs(["a", "b", "c"], ""), -1), "c");
  assert.equal(step(tabs([]), 1), undefined);
});

test("number keys pick by position and 9 picks the last tab", () => {
  const t = tabs(["a", "b", "c"]);
  assert.equal(numbered(t, 1), "a");
  assert.equal(numbered(t, 3), "c");
  assert.equal(numbered(t, 5), undefined);
  assert.equal(numbered(t, 9), "c");
});

test("a stored value keeps only unique chat ids, up to the limit", () => {
  assert.deepEqual(tabsOf(["a", 3, "a", "", "b", null], "b"), tabs(["a", "b"], "b"));
  assert.deepEqual(tabsOf("nope", 7), tabs([], ""));
  const many = Array.from({ length: MAX_TABS + 5 }, (_, i) => `t${i}`);
  assert.equal(tabsOf(many, "t0").ids.length, MAX_TABS);
});
