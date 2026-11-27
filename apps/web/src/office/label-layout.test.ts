import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeOfficeLabels } from "./label-layout.ts";

test("overlapping agents remain individually clickable within the office", () => {
  const labels = Array.from({ length: 48 }, (_, i) => ({ id: String(i), x: 450, y: 250, width: 30, height: 30 }));
  const positions = arrangeOfficeLabels(labels, 900, 500);
  assert.equal(positions.size, 48);
  for (const [id, rect] of positions) {
    assert.ok(rect.x >= 8 && rect.x + rect.width <= 892);
    assert.ok(rect.y >= 48 && rect.y + rect.height <= 420);
    for (const [otherId, other] of positions) {
      if (id === otherId) continue;
      assert.ok(
        rect.x + rect.width <= other.x ||
          other.x + other.width <= rect.x ||
          rect.y + rect.height <= other.y ||
          other.y + other.height <= rect.y,
      );
    }
  }
  assert.deepEqual(arrangeOfficeLabels(labels, 900, 500), positions);
});

test("labels avoid the zoom's actual bounds even when it sits above the reserved footer", () => {
  const zoom = { x: 700, y: 290, width: 140, height: 44 };
  const placed = arrangeOfficeLabels([{ id: "room", x: 760, y: 325, width: 130, height: 40 }], 900, 500, [zoom]);
  const rect = placed.get("room");
  assert.ok(rect);
  assert.ok(
    rect.x + rect.width <= zoom.x ||
      zoom.x + zoom.width <= rect.x ||
      rect.y + rect.height <= zoom.y ||
      zoom.y + zoom.height <= rect.y,
  );
});

test("room names do not cover people, and labels outside the available space are omitted", () => {
  const labels = [
    { id: "person", x: 100, y: 150, width: 130, height: 44 },
    { id: "room", x: 100, y: 150, width: 130, height: 44 },
    { id: "oversized", x: 100, y: 150, width: 600, height: 44 },
  ];
  const placed = arrangeOfficeLabels(labels, 300, 360);
  assert.equal(placed.size, 2);
  assert.notDeepEqual(placed.get("person"), placed.get("room"));
  assert.equal(placed.has("oversized"), false);
  for (const rect of placed.values()) assert.ok(rect.y + rect.height <= 240);
});
