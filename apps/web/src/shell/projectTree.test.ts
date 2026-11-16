import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DEPTH, projectsKnowing, projectsUnder, projectTree } from "./projectTree.ts";

const ids = (rows: { entry: { id: string }; depth: number }[]) => rows.map((r) => `${r.depth}:${r.entry.id}`);

test("with no project under another the rows are the list as it was", () => {
  const list = [{ id: "base" }, { id: "b" }, { id: "a" }, { id: "c" }];
  const rows = projectTree(list, []);
  assert.deepEqual(ids(rows), ["0:base", "0:b", "0:a", "0:c"]);
  assert.ok(rows.every((r) => r.children === 0 && !r.open));
});

test("a project sits right after the one it is under, keeping the given order among siblings", () => {
  const list = [{ id: "base" }, { id: "c", parent: "a" }, { id: "a" }, { id: "b", parent: "a" }, { id: "d" }];
  const rows = projectTree(list, []);
  assert.deepEqual(ids(rows), ["0:base", "0:a", "1:c", "1:b", "0:d"]);
  assert.deepEqual(rows[1], { entry: { id: "a" }, depth: 0, children: 2, open: true });
});

test("a closed project hides what is under it, unless the open project is in there", () => {
  const list = [{ id: "a" }, { id: "b", parent: "a" }, { id: "c", parent: "b" }, { id: "d" }];
  assert.deepEqual(ids(projectTree(list, ["a"])), ["0:a", "0:d"]);
  assert.equal(projectTree(list, ["a"])[0]?.open, false);
  assert.deepEqual(ids(projectTree(list, ["a", "b"], "c")), ["0:a", "1:b", "2:c", "0:d"]);
  assert.deepEqual(ids(projectTree(list, ["b"], "b")), ["0:a", "1:b", "0:d"]);
});

test("a parent that is not listed, itself or a loop leaves the project on top", () => {
  const list = [
    { id: "a", parent: "gone" },
    { id: "b", parent: "b" },
    { id: "x", parent: "y" },
    { id: "y", parent: "x" },
  ];
  assert.deepEqual(ids(projectTree(list, [])), ["0:a", "0:b", "0:x", "0:y"]);
});

test("the indent stops growing past the deepest level", () => {
  const list = [{ id: "p0" }, ...[1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, parent: `p${n - 1}` }))];
  const rows = projectTree(list, []);
  assert.equal(rows.length, 6);
  assert.equal(rows.at(-1)?.depth, MAX_DEPTH);
});

test("what sits under a project, at any depth, cannot be chosen as where it sits", () => {
  const list = [{ id: "a" }, { id: "b", parent: "a" }, { id: "c", parent: "b" }, { id: "d" }];
  assert.deepEqual([...projectsUnder(list, "a")].sort(), ["b", "c"]);
  assert.deepEqual([...projectsUnder(list, "c")], []);
});

test("the projects that already know one, directly or through others, are the ones it cannot know back", () => {
  // a → b → c, d → c, e knows nobody, f knows itself by a broken value.
  const list = [
    { id: "a", knows: ["b"] },
    { id: "b", knows: ["c"] },
    { id: "c" },
    { id: "d", knows: ["c", "gone"] },
    { id: "e" },
    { id: "f", knows: ["f"] },
  ];
  assert.deepEqual([...projectsKnowing(list, "c")].sort(), ["a", "b", "d"]);
  assert.deepEqual([...projectsKnowing(list, "b")], ["a"]);
  assert.deepEqual([...projectsKnowing(list, "a")], []);
  assert.deepEqual([...projectsKnowing(list, "e")], []);
  // Never itself, and a loop already saved ends.
  assert.deepEqual([...projectsKnowing(list, "f")], []);
  const loop = [
    { id: "x", knows: ["y"] },
    { id: "y", knows: ["x"] },
  ];
  assert.deepEqual([...projectsKnowing(loop, "x")], ["y"]);
});
