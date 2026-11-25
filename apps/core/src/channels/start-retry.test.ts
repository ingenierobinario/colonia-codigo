import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { type ChannelAdapter, ChannelRefused } from "./types.ts";

// A platform that fails its first starts the way an unreachable network does, then works; "refused" never does.
const starts = { flaky: 0, refused: 0 };
const adapter = (id: "flaky" | "refused"): ChannelAdapter => ({
  caps: { typing: false, buttons: false },
  async start() {
    starts[id]++;
    if (id === "refused") throw new ChannelRefused("bad token");
    if (starts.flaky < 3) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    return { account: "@flaky_bot" };
  },
  async stop() {},
  async send() {
    return {};
  },
});

let env: Awaited<ReturnType<typeof startCore>>;
const timers = manualTimers();
before(async () => {
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    channelAdapters: { telegram: (c) => adapter(c.id === "refused" ? "refused" : "flaky") },
    channelRetryMs: [20, 40],
    channelRetryTimers: timers,
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const info = async (id: string) => (await env.client.call("channels.list", {})).channels.find((c) => c.id === id);

test("a channel that could not reach its platform says why and starts again on its own", async () => {
  await env.client.call("channels.set", {
    id: "flaky",
    channel: { type: "telegram", agent_id: "superagent" },
    token: "123456:TEST",
  });
  const first = await info("flaky");
  assert.equal(first?.status, "error");
  assert.equal(first?.error, "fetch failed (ENOTFOUND)");
  assert.equal(starts.flaky, 1);
  timers.tick(20);
  await waitFor(() => starts.flaky === 2 && timers.pending() === 1, "the second failed start to schedule its retry");
  assert.equal((await info("flaky"))?.status, "error");
  timers.tick(40);
  await waitFor(async () => (await info("flaky"))?.status === "running", "the channel to restart");
  assert.equal((await info("flaky"))?.status, "running");
  assert.equal(starts.flaky, 3);
});

test("a refused token is not retried", async () => {
  await env.client.call("channels.set", {
    id: "refused",
    channel: { type: "telegram", agent_id: "superagent" },
    token: "123456:TEST",
  });
  assert.equal(timers.pending(), 0);
  timers.tick(150);
  assert.equal(starts.refused, 1);
  assert.equal((await info("refused"))?.error, "bad token");
});

test("removing a channel cancels its scheduled retry", async () => {
  starts.flaky = 0;
  await env.client.call("channels.set", {
    id: "stopped",
    channel: { type: "telegram", agent_id: "superagent" },
    token: "123456:TEST",
  });
  assert.equal((await info("stopped"))?.status, "error");
  assert.equal(timers.pending(), 1);
  await env.client.call("channels.set", { id: "stopped", channel: null });
  assert.equal(timers.pending(), 0);
  timers.tick(1000);
  assert.equal(starts.flaky, 1);
  assert.equal(await info("stopped"), undefined);
});
