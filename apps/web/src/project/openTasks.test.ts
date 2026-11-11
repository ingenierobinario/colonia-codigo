import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "@colonia/protocol";
import { openByGroup } from "./openTasks.ts";

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: "",
  status: "todo",
  state: "open",
  kind: "task",
  priority: "normal",
  tags: [],
  thread_id: `th_${id}`,
  awaits_owner: false,
  renegotiated: 0,
  chats: 0,
  created_by: "owner",
  created_at: "2030-01-01T10:00:00Z",
  updated_at: "2030-01-01T10:00:00Z",
  activity_at: "2030-01-01T10:00:00Z",
  ...over,
});

const shape = (groups: ReturnType<typeof openByGroup>) => groups.map((g) => [g.id, g.items.map((x) => x.id)]);

test("open tasks group in the list's order, newest activity first, and closed ones never count", () => {
  const groups = openByGroup(
    [
      task("old", { activity_at: "2030-01-01T09:00:00Z" }),
      task("new", { activity_at: "2030-01-03T09:00:00Z" }),
      task("moving", { status: "doing" }),
      task("asks", { status: "doing", awaits_owner: true }),
      task("done", { state: "done" }),
      task("dropped", { state: "dropped" }),
    ],
    new Set(),
  );
  assert.deepEqual(shape(groups), [
    ["blocked", ["asks"]],
    ["doing", ["moving"]],
    ["pending", ["new", "old"]],
  ]);
});

test("a task with a turn running counts as in progress; with nothing open there are no groups", () => {
  assert.deepEqual(shape(openByGroup([task("a"), task("b")], new Set(["th_b"]))), [
    ["doing", ["b"]],
    ["pending", ["a"]],
  ]);
  assert.deepEqual(openByGroup([task("done", { state: "done" })], new Set()), []);
  assert.deepEqual(openByGroup([], new Set()), []);
});
