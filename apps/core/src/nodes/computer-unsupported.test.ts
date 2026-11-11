import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_CAP, NO_COMPUTER_CAP } from "@colonia/protocol";
import { ColoniaClient } from "@colonia/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const OFFER = "[Config › Desktop](colonia:settings/desktop), where they turn it on";

// A desktop that can never lend computer use (Linux) says so, and the agent is not told the owner can turn it on.
for (const [caps, offered] of [
  [[BROWSER_CAP], true],
  [[BROWSER_CAP, NO_COMPUTER_CAP], false],
] as const) {
  test(`a desktop linked with ${caps.join(" + ")} ${offered ? "gets" : "does not get"} the turn-it-on hint`, async () => {
    const llm = scriptedLlm(() => say("ok"));
    const env = await startCore({ llm });
    const desktop = await new ColoniaClient({ url: env.core.url }).connect("node", [...caps]);
    try {
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await env.client.call("threads.send", { thread: thread.id, text: "hi" });
      await env.settle(thread.id);
      assert.equal(String(llm.calls.at(-1)?.messages[0]?.content).includes(OFFER), offered);
    } finally {
      desktop.close();
      await env.core.close();
      await env.cleanup();
    }
  });
}
