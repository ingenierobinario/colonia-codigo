import assert from "node:assert/strict";
import { test } from "node:test";
import { close, MAX_TABS, move, numbered, open, prune, renamed, step, type Tabs, tabsOf } from "./tabs.ts";

const tabs = (ids: string[], active = ids[0] ?? ""): Tabs => ({ ids, active });

test("a chat picked in the list opens in a tab of its own, right after the active one", () => {
  assert.deepEqual(open(tabs(["a", "b", "c"], "a"), "x"), tabs(["a", "x", "b", "c"], "x"));
  assert.deepEqual(open(tabs(["a", "b"], "b"), "x"), tabs(["a", "b", "x"], "x"));
});

test("picking chat after chat piles the tabs up, none taking another's place", () => {
  let now = tabs([]);
  for (const id of ["a", "b", "c"]) now = open(now, id);
  assert.deepEqual(now, tabs(["a", "b", "c"], "c"));
});

test("a chat that already has a tab is brought forward, not opened twice", () => {
  assert.deepEqual(open(tabs(["a", "b", "c"], "a"), "c"), tabs(["a", "b", "c"], "c"));
  const again = open(open(tabs(["a", "b"], "b"), "x"), "a");
  assert.deepEqual(open(again, "x"), tabs(["a", "b", "x"], "x"));
});

test("opening the active tab again changes nothing", () => {
  const before = tabs(["a", "b"], "b");
  assert.equal(open(before, "b"), before);
});

test("the first chat on screen becomes the first tab", () => {
  assert.deepEqual(open(tabs([]), "a"), tabs(["a"], "a"));
});

test("with no active tab the chat is added at the end", () => {
  assert.deepEqual(open(tabs(["a", "b"], ""), "x"), tabs(["a", "b", "x"], "x"));
  assert.deepEqual(open(tabs(["a", "b"], "gone"), "x"), tabs(["a", "b", "x"], "x"));
});

test("at the limit a new tab still opens, and the first one that is not on screen makes way", () => {
  const ids = Array.from({ length: MAX_TABS }, (_, i) => `t${i}`);
  const next = open(tabs(ids, "t3"), "x");
  assert.equal(next.ids.length, MAX_TABS);
  assert.deepEqual(next.ids.slice(0, 4), ["t1", "t2", "t3", "x"]);
  assert.equal(next.active, "x");
  const first = open(tabs(ids, "t0"), "x");
  assert.deepEqual(first.ids.slice(0, 3), ["t0", "x", "t2"]);
  assert.equal(first.ids.length, MAX_TABS);
});

test("a chat made from a new-chat tab keeps the place of that tab", () => {
  const made = open(renamed(tabs(["a", "new:agent=main", "c"], "new:agent=main"), "new:agent=main", "th_1"), "th_1");
  assert.deepEqual(made, tabs(["a", "th_1", "c"], "th_1"));
});

test("a new chat made while another tab is on screen keeps its tab", () => {
  assert.deepEqual(
    renamed(tabs(["a", "new:agent=main", "c"], "a"), "new:agent=main", "th_1"),
    tabs(["a", "th_1", "c"], "a"),
  );
  assert.deepEqual(renamed(tabs(["a", "new:agent=main"], "new:agent=main"), "new:agent=main", "a"), tabs(["a"], "a"));
  const before = tabs(["a", "b"], "a");
  assert.equal(renamed(before, "zzz", "th_1"), before);
});

test("closing the active tab hands over to the one on its right, or on its left at the end", () => {
  assert.deepEqual(close(tabs(["a", "b", "c"], "b"), "b"), tabs(["a", "c"], "c"));
  assert.deepEqual(close(tabs(["a", "b", "c"], "c"), "c"), tabs(["a", "b"], "b"));
});

test("closing the last tab leaves none, and the next chat starts the tabs again", () => {
  const none = close(tabs(["a"], "a"), "a");
  assert.deepEqual(none, tabs([], ""));
  assert.equal(step(none, 1), undefined);
  assert.equal(numbered(none, 1), undefined);
  assert.equal(close(none, "a"), none);
  assert.deepEqual(open(none, "b"), tabs(["b"], "b"));
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
