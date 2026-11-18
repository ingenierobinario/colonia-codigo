import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveFeed, LIVE_CLOSED, type LiveEvent, type LiveState, liveReduce } from "./screenLiveState.ts";

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

test("el relevo retira la identidad y conserva la posición y el tamaño elegidos hasta la nueva acción", () => {
  const initial = run([look(1)]);
  const between = liveReduce(initial, { type: "handoff" });
  assert.equal(between.last, undefined);
  assert.equal(between.handoff, true);
  assert.equal(liveReduce(between, look(3)).handoff, undefined);
});

test("el relevo recibido entre dos montajes del chat llega al nuevo montaje y caduca al quedar inactivo", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let emit: (event: LiveEvent) => void = () => assert.fail("sin enlace");
  let connections = 0;
  const feed = createLiveFeed((fn) => {
    emit = fn;
    connections++;
  });
  const detach = feed.subscribe(() => {});
  emit(look(1));
  detach();
  emit({
    ...look(2),
    type: "activity",
    activity: { kind: "click", app: "Calc", window: "1", actor: { id: "dos", name: "Sol" } },
    at: 2,
  });
  const close = feed.subscribe(() => {});
  assert.equal(feed.get().last?.actor?.id, "dos");
  assert.equal(connections, 1);
  close();
  t.mock.timers.tick(180_000);
  assert.deepEqual(feed.get(), LIVE_CLOSED);
});

test("el primer gesto queda disponible antes de que se cargue la tarjeta del chat", () => {
  let actor: (event: LiveEvent) => void = () => assert.fail("el escritorio aún no escucha");
  const feed = createLiveFeed((listener) => {
    actor = listener;
  });
  actor({
    type: "activity",
    at: 1,
    activity: { kind: "look", app: "Editor", window: "Documento", actor: { id: "uno", name: "Alba" } },
  });
  const off = feed.subscribe(() => {});
  assert.equal(feed.get().last?.actor?.id, "uno");
  feed.dispatch({ type: "close" });
  off();
});
