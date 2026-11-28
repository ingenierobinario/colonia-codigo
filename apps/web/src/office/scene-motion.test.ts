import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneLayout } from "./scene-layout.ts";
import { officeMotion } from "./scene-motion.ts";

function fixture(count = 1) {
  const rooms = Array.from({ length: count }, (_, i) => ({ id: `room-${i}`, agents: [{ id: `person-${i}` }] }));
  const motion = officeMotion(sceneLayout(rooms));
  const presence = new Map(
    rooms.flatMap((room) =>
      room.agents.map((agent) => [agent.id, { presence: "idle" as "idle" | "working" | "offline" }]),
    ),
  );
  let time = 0;
  motion.update(time, true, presence);
  return {
    motion,
    presence,
    advance(seconds: number, enabled = true) {
      for (let i = 0; i < seconds * 20; i++) {
        time += 50;
        motion.update(time, enabled, presence);
      }
    },
  };
}

test("idle colleagues walk to coffee and return along the aisles without teleporting", () => {
  const { motion, advance } = fixture();
  const walker = motion.walkers[0];
  assert.ok(walker);
  let coffee = false;
  let returned = false;
  for (let i = 0; i < 1200; i++) {
    const before = { ...walker.point };
    advance(0.05);
    assert.ok(Math.hypot(walker.point.x - before.x, walker.point.z - before.z) <= 0.101);
    coffee ||= walker.state === "coffee";
    if (coffee && walker.state === "desk") {
      returned = true;
      break;
    }
  }
  assert.ok(coffee);
  assert.ok(returned);
  assert.deepEqual(walker.point, walker.home);
});

test("pause, hidden time and offline state do not advance a walk; new work brings the colleague back", () => {
  const { motion, presence, advance } = fixture();
  const walker = motion.walkers[0];
  assert.ok(walker);
  advance(3);
  assert.equal(walker.state, "out");
  const before = { ...walker.point };
  advance(100, false);
  assert.deepEqual(walker.point, before);
  motion.resetClock();
  advance(0.05);
  assert.deepEqual(walker.point, before);
  presence.set(walker.id, { presence: "offline" });
  advance(3);
  assert.deepEqual(walker.point, before);
  presence.set(walker.id, { presence: "working" });
  advance(0.05);
  assert.equal(walker.state, "back");
  advance(20);
  assert.equal(walker.state, "desk");
  assert.deepEqual(walker.point, walker.home);
});

test("coffee has at most four visitors and working colleagues remain at their desks", () => {
  const { motion, presence, advance } = fixture(12);
  presence.set("person-0", { presence: "working" });
  for (let i = 0; i < 1200; i++) {
    advance(0.05);
    const visitors = motion.walkers.filter((walker) => walker.state !== "desk");
    assert.ok(visitors.length <= 4);
    assert.equal(new Set(visitors.map((walker) => walker.slot)).size, visitors.length);
    assert.equal(motion.walkers[0]?.state, "desk");
  }
});
