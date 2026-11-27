import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneLayout } from "./scene-layout.ts";

test("large teams stay within their room and rooms do not overlap", () => {
  const rooms = sceneLayout(
    [1, 31, 0, 9].map((count, i) => ({
      id: String(i),
      agents: Array.from({ length: count }, (_, n) => ({ id: `${i}-${n}` })),
    })),
  );
  for (const room of rooms) {
    for (const station of room.stations) {
      assert.ok(station.x > 1 && station.x + 1 < room.width);
      assert.ok(station.z > 1 && station.z + 1.5 < room.depth);
    }
    for (const other of rooms) {
      if (room === other) continue;
      assert.ok(
        room.x + room.width < other.x ||
          other.x + other.width < room.x ||
          room.z + room.depth < other.z ||
          other.z + other.depth < room.z,
      );
    }
  }
});
