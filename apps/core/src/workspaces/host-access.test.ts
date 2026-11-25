import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccess, type TailscaleRun } from "../access.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createPublicTunnel } from "../public-tunnel.ts";

test("a business cannot inspect, replace or disable the host's Tailscale configuration, including restored choices", async () => {
  const calls: string[][] = [];
  const tailscale: TailscaleRun = async (args) => {
    calls.push(args);
    return { ok: true, out: JSON.stringify({ Self: { DNSName: "shared.example.ts.net." } }) };
  };
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), tailscale });
  const access = createAccess({
    workspace: true,
    home: env.home,
    running: { host: "127.0.0.1", publicUrl: "https://example.com/business", token: "private-test-token" },
    port: () => 7440,
    addresses: () => [],
    tailscale,
  });
  const tunnel = createPublicTunnel({
    workspace: true,
    store: env.core.store,
    home: env.home,
    port: () => 7442,
    log: createLog("test", true),
    tailscale,
  });
  try {
    assert.equal((await access.state()).tailscale.installed, false);
    await assert.rejects(access.set("tailscale"), /My Colonia/);
    await assert.rejects(access.set("local"), /My Colonia/);
    env.core.store.settings.write("webhooks", { mode: "tailscale" });
    await tunnel.start();
    await tunnel.set({ mode: "off" });
    await assert.rejects(tunnel.set({ mode: "tailscale" }), /My Colonia/);
    assert.deepEqual(calls, []);
  } finally {
    tunnel.close();
    await env.core.close();
    await env.cleanup();
  }
});
