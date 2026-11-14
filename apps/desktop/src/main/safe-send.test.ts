import assert from "node:assert/strict";
import { test } from "node:test";
import { sendTo } from "./safe-send.ts";

test("a message reaches a living panel and is dropped for one that is gone", () => {
  const got: unknown[][] = [];
  let destroyed = false;
  const panel = {
    isDestroyed: () => destroyed,
    send: (channel: string, ...args: unknown[]) => {
      if (destroyed) throw new Error("Object has been destroyed");
      got.push([channel, ...args]);
    },
  };
  assert.equal(sendTo(panel, "nav:thread", "t1"), true);
  destroyed = true;
  assert.equal(sendTo(panel, "nav:thread", "t2"), false);
  assert.equal(sendTo(undefined, "nav:thread", "t3"), false);
  assert.deepEqual(got, [["nav:thread", "t1"]]);
});

test("a panel destroyed between the check and the send throws nothing", () => {
  const panel = {
    isDestroyed: () => false,
    send: () => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    },
  };
  assert.equal(sendTo(panel, "computer:activity", {}), false);
});
