import assert from "node:assert/strict";
import { test } from "node:test";
import { peerName, renamePeer } from "./peer-name.ts";

test("a peer name is normalized, resettable and bound to its identity", () => {
  const peer = { id: "server-a", name: "container-host", alias: "Previous" };
  let saves = 0;
  renamePeer(peer, "server-a", "  Acme\n server  ", () => saves++);
  assert.deepEqual(peerName(peer), {
    id: "server-a",
    name: "Acme server",
    hostname: "container-host",
    alias: "Acme server",
  });
  assert.throws(() => renamePeer(peer, "server-b", "Wrong", () => saves++), /changed/);
  assert.equal(peerName(peer).name, "Acme server");
  renamePeer(peer, "server-a", "container-host", () => saves++);
  assert.equal(peerName(peer).name, "container-host");
  assert.equal(peerName(peer).alias, undefined);
  assert.equal(saves, 2);
  assert.throws(() => renamePeer(undefined, "server-a", "Wrong", () => saves++), /changed/);
});

test("a failed save preserves the previous name", () => {
  const peer = { id: "server-a", name: "container-host", alias: "Previous" };
  assert.throws(
    () =>
      renamePeer(peer, peer.id, "Changed", () => {
        throw new Error("disk unavailable");
      }),
    /disk unavailable/,
  );
  assert.equal(peerName(peer).name, "Previous");
});
