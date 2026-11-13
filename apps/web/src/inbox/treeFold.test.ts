import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@colonia/protocol";
import { groupByAgent } from "./groupThreads.ts";
import { toggleFolded, treeFoldKey, treeUnread } from "./treeFold.ts";

const chat = (id: string, channel: string, unread = 0): Thread =>
  ({
    id,
    kind: "loose",
    title: id,
    agent_ids: ["superagent"],
    state: "completed",
    preview: "",
    unread,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    channel: { id: channel, type: "whatsapp", conversation: `${id}@s.whatsapp.net` },
  }) as Thread;

// ARBOL-PLEGAR-1: two accounts of the same channel (WhatsApp Spain and Andorra).
const threads = {
  a: chat("a", "wa-es", 2),
  b: chat("b", "wa-es"),
  c: chat("c", "wa-es", 1),
  d: chat("d", "wa-ad", 4),
};
const names = new Map([
  ["wa-es", "Whatsapp España"],
  ["wa-ad", "Whatsapp Andorra"],
]);
const trees = groupByAgent(threads, [], {}, names);
const tree = (name: string) => {
  const found = trees.find((t) => t.name === name);
  assert.ok(found, name);
  return found;
};

test("two accounts of one channel are two groups with their own fold key", () => {
  assert.equal(trees.length, 2);
  const es = treeFoldKey(undefined, tree("Whatsapp España"));
  const ad = treeFoldKey(undefined, tree("Whatsapp Andorra"));
  assert.notEqual(es, ad);
  assert.equal(es, "tree:inbox:channel:wa-es");
});

test("folding one account leaves the other open, and unfolding restores it", () => {
  const es = treeFoldKey(undefined, tree("Whatsapp España"));
  const ad = treeFoldKey(undefined, tree("Whatsapp Andorra"));
  const folded = toggleFolded([], es);
  assert.equal(folded.includes(es), true);
  assert.equal(folded.includes(ad), false);
  assert.deepEqual(toggleFolded(folded, es), []);
  assert.deepEqual(toggleFolded(folded, ad), [es, ad]);
});

test("a group folds apart in each project's list and in the Inbox", () => {
  const group = { key: "p1" };
  assert.notEqual(treeFoldKey("p1", group), treeFoldKey(undefined, group));
  assert.notEqual(treeFoldKey("p1", { key: "channel:wa-es" }), treeFoldKey("p2", { key: "channel:wa-es" }));
  assert.equal(toggleFolded([], treeFoldKey("p1", group)).includes(treeFoldKey(undefined, group)), false);
});

test("a folded group says how many of its chats have something unread", () => {
  assert.equal(treeUnread(tree("Whatsapp España")), 2);
  assert.equal(treeUnread(tree("Whatsapp Andorra")), 1);
  assert.equal(treeUnread({ agents: [] }), 0);
});

test("the oldest folds are forgotten past the cap", () => {
  let folded: string[] = [];
  for (let i = 0; i < 305; i++) folded = toggleFolded(folded, `k${i}`);
  assert.equal(folded.length, 300);
  assert.equal(folded[0], "k5");
});
