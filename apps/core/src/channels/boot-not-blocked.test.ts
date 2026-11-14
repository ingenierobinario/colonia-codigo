import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import type { ChannelAdapter } from "./types.ts";

test("PERF-7: the core is up while its channels still connect; two accounts of one kind each start on their own", async () => {
  const home = tempDir("colonia-boot-").path;
  // The network of each account answers when the test says so.
  const gates = new Map<string, () => void>();
  let held = false;
  const slow = (id: string): ChannelAdapter => ({
    caps: { typing: false, buttons: false },
    start: () =>
      held ? new Promise((resolve) => gates.set(id, () => resolve({ account: `@${id}` }))) : Promise.resolve({}),
    stop: async () => gates.get(id)?.(),
    send: async () => ({}),
  });
  const boot = () =>
    startCore({ home, llm: scriptedLlm(() => say("ok")), channelAdapters: { telegram: (c) => slow(c.id) } });
  const statuses = async (env: Awaited<ReturnType<typeof boot>>) =>
    Object.fromEntries((await env.client.call("channels.list", {})).channels.map((c) => [c.id, c.status]));
  let env = await boot();
  try {
    for (const id of ["tg-1", "tg-2"])
      await env.client.call("channels.set", {
        id,
        channel: { type: "telegram", agent_id: "superagent" },
        token: `123456:${id}-token`,
      });
    await waitFor(async () => (await statuses(env))["tg-2"] === "running", "both running");
    await env.core.close();

    held = true;
    // Before PERF-7 this never came back: the core waited for every channel's network before it was up.
    env = await boot();
    await waitFor(() => gates.size === 2, "both accounts connecting");
    assert.deepEqual(await statuses(env), { "tg-1": "starting", "tg-2": "starting" });
    gates.get("tg-2")?.();
    await waitFor(async () => (await statuses(env))["tg-2"] === "running", "the second account up");
    assert.equal((await statuses(env))["tg-1"], "starting", "the first still waits for its own network");
    gates.get("tg-1")?.();
    await waitFor(async () => (await statuses(env))["tg-1"] === "running", "the first account up");
  } finally {
    await env.core.close();
    await env.cleanup();
    removeDir(home);
  }
});
