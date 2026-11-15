import assert from "node:assert/strict";
import { test } from "node:test";
import { addChannelChoices } from "./addChoices.ts";
import { CHANNEL_KIND_IDS } from "./kinds.ts";

test("the add menu lists every kind, also the ones that already have accounts", () => {
  // Two WhatsApp numbers and a Slack workspace connected: the three kinds stay in the list.
  const { ready, soon } = addChannelChoices(["whatsapp", "whatsapp", "slack"]);
  assert.deepEqual([...ready, ...soon].map((c) => c.kind).sort(), [...CHANNEL_KIND_IDS].sort());
  assert.deepEqual(
    ready.filter((c) => c.another).map((c) => c.kind),
    ["whatsapp", "slack"],
  );
});

test("picking a kind that has an account adds another one; a kind with none is a first setup", () => {
  const { ready } = addChannelChoices(["whatsapp"]);
  assert.equal(ready.find((c) => c.kind === "whatsapp")?.another, true);
  assert.equal(ready.find((c) => c.kind === "telegram")?.another, false);
  assert.equal(
    addChannelChoices([]).ready.some((c) => c.another),
    false,
  );
});

test("iMessage is this Mac: connected, it is still listed but opens instead of adding a second one", () => {
  const { ready } = addChannelChoices(["imessage"]);
  assert.deepEqual(
    ready.find((c) => c.kind === "imessage"),
    { kind: "imessage", another: false },
  );
});
