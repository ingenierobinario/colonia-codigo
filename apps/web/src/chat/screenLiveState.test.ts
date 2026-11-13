import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_CLOSED, type LiveEvent, type LiveState, liveReduce } from "./screenLiveState.ts";

const look = (at: number): LiveEvent => ({
  type: "activity",
  activity: { kind: "look", app: "Colonia", window: "Colonia" },
  at,
});
const run = (events: LiveEvent[], from: LiveState = LIVE_CLOSED) => events.reduce(liveReduce, from);

test("DETENER-VIVO-1: the card opens with the agent's first action and follows the last one", () => {
  const s = run([look(1), look(2)]);
  assert.equal(s.last?.at, 2);
  assert.equal(s.stopped, false);
});

test("DETENER-VIVO-1: after the stop the card says so, then closes by itself when the hold is over", () => {
  const held = run([look(1), { type: "stopped", stopped: true }]);
  assert.equal(held.stopped, true);
  assert.ok(held.last, "still open while it says it stopped");
  const after = liveReduce(held, { type: "stopped", stopped: false });
  assert.deepEqual(after, LIVE_CLOSED);
});

test("DETENER-VIVO-1: an action already on its way when the owner stopped does not reopen or refresh the card", () => {
  const held = run([look(1), { type: "stopped", stopped: true }, look(5)]);
  assert.equal(held.last?.at, 1);
  assert.deepEqual(liveReduce(held, { type: "stopped", stopped: false }), LIVE_CLOSED);
});

test("DETENER-VIVO-1: the owner's close button closes the card, stopped or not, and a new session opens it again", () => {
  assert.deepEqual(run([look(1), { type: "close" }]), LIVE_CLOSED);
  assert.deepEqual(run([look(1), { type: "stopped", stopped: true }, { type: "close" }]), LIVE_CLOSED);
  assert.equal(run([look(1), { type: "stopped", stopped: true }, { type: "close" }, look(9)]).last?.at, 9);
});

test("DETENER-VIVO-1: the end of a hold with nothing stopped here changes nothing", () => {
  const open = run([look(1)]);
  assert.equal(liveReduce(open, { type: "stopped", stopped: false }), open);
  assert.deepEqual(liveReduce(LIVE_CLOSED, { type: "stopped", stopped: false }), LIVE_CLOSED);
});
