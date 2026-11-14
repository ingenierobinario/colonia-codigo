import assert from "node:assert/strict";
import { test } from "node:test";
import { waitOnQuit } from "./quit-wait.ts";

function harness(stop: () => Promise<unknown>) {
  const said: string[] = [];
  let due: (() => void) | undefined;
  const handler = waitOnQuit({
    stop: () => {
      said.push("stop");
      return stop();
    },
    quit: () => said.push("quit"),
    first: () => said.push("first"),
    last: () => said.push("last"),
    after: (_ms, fn) => {
      due = fn;
      return () => {
        due = undefined;
      };
    },
  });
  const quit = () => {
    let held = false;
    const through = handler({ preventDefault: () => (held = true) });
    return { held, through };
  };
  return { said, quit, timeout: () => due?.() };
}
const settle = () => new Promise((r) => setImmediate(r));

test("quitting is held until the core has stopped, then goes through once", async () => {
  let stopped: () => void = () => {};
  const h = harness(() => new Promise<void>((r) => (stopped = r)));
  assert.deepEqual(h.quit(), { held: true, through: false });
  await settle();
  assert.deepEqual(h.said, ["first", "stop"]);
  // Asked again while it waits: still held, and the core is not stopped twice.
  assert.deepEqual(h.quit(), { held: true, through: false });
  stopped();
  await settle();
  assert.deepEqual(h.said, ["first", "stop", "last", "quit"]);
  assert.deepEqual(h.quit(), { held: false, through: true });
  // The wait that ran out later changes nothing.
  h.timeout();
  assert.deepEqual(h.said, ["first", "stop", "last", "quit"]);
});

test("a core that never stops does not keep the app open past the wait", async () => {
  const h = harness(() => new Promise(() => {}));
  h.quit();
  await settle();
  h.timeout();
  assert.deepEqual(h.said, ["first", "stop", "last", "quit"]);
  assert.deepEqual(h.quit(), { held: false, through: true });
});

test("a stop that fails still lets the app quit", async () => {
  const h = harness(() => Promise.reject(new Error("no core")));
  h.quit();
  await settle();
  assert.deepEqual(h.said, ["first", "stop", "last", "quit"]);
});
