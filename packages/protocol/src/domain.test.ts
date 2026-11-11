import assert from "node:assert/strict";
import { test } from "node:test";
import { Message, PROJECT_ICONS, ProjectMark } from "./domain.ts";

test("a part type this client does not know becomes a notice instead of breaking the message", () => {
  const m = Message.parse({
    id: "m1",
    thread_id: "t1",
    seq: 1,
    author: { kind: "agent", id: "superagent" },
    parts: [
      { type: "text", text: "hi" },
      { type: "hologram", frames: 3 },
    ],
    created_at: "2026-10-01T00:00:00Z",
  });
  assert.deepEqual(m.parts[0], { type: "text", text: "hi" });
  assert.equal(m.parts[1]?.type, "notice");
  assert.match(m.parts[1]?.type === "notice" ? m.parts[1].text : "", /hologram/);
});

test("a project's icon is one of the listed names, and a tile carries one drawing at most", () => {
  assert.equal(new Set(PROJECT_ICONS).size, PROJECT_ICONS.length);
  assert.ok(PROJECT_ICONS.every((id) => /^[a-z0-9-]{1,40}$/.test(id)));
  assert.deepEqual(ProjectMark.parse({ icon: "rocket", tone: "violet" }), { icon: "rocket", tone: "violet" });
  assert.equal(ProjectMark.safeParse({ icon: "not-an-icon" }).success, false);
  assert.equal(ProjectMark.safeParse({ icon: "rocket", emoji: "🚀" }).success, false);
  assert.deepEqual(ProjectMark.parse({ tone: "ink" }), { tone: "ink" });
});
