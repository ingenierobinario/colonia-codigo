import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import type { ChannelAdapter } from "./types.ts";

// ARRANQUE-RAPIDO-1: un canal que tarda 5 s en conectar no retrasa ni el listen ni el arranque entero del núcleo.
test("ARRANQUE-RAPIDO-1: con un canal que tarda 5 s en conectar, el núcleo escucha y sirve al panel antes", async () => {
  const home = tempDir("colonia-listen-").path;
  let slow = false;
  let connected = 0;
  const adapter = (): ChannelAdapter => ({
    caps: { typing: false, buttons: false },
    start: () =>
      slow
        ? new Promise((resolve) =>
            setTimeout(() => {
              connected = Date.now();
              resolve({ account: "@lento" });
            }, 5000),
          )
        : Promise.resolve({}),
    stop: async () => {},
    send: async () => ({}),
  });
  const boot = () =>
    startCore({ home, llm: scriptedLlm(() => say("ok")), channelAdapters: { telegram: () => adapter() } });
  let env = await boot();
  try {
    await env.client.call("channels.set", {
      id: "tg-lento",
      channel: { type: "telegram", agent_id: "superagent" },
      token: "123456:lento-token",
    });
    await env.core.close();

    slow = true;
    const t0 = Date.now();
    env = await boot();
    const up = Date.now();
    const health = await fetch(new URL("/health", env.core.url));
    const served = Date.now();
    assert.equal(health.status, 200);
    const list = await env.client.call("channels.list", {});
    assert.equal(list.channels.find((c) => c.id === "tg-lento")?.status, "starting");
    assert.ok(up - t0 < 4000, `el núcleo arrancó en ${up - t0} ms, sin esperar los 5 s del canal`);
    assert.equal(connected, 0, "el panel se sirvió antes de que el canal conectase");
    assert.ok(served - t0 < 4500);
    await waitFor(async () => {
      const l = await env.client.call("channels.list", {});
      return l.channels.find((c) => c.id === "tg-lento")?.status === "running";
    }, "el canal lento acaba conectando en segundo plano");
    assert.ok(connected - t0 >= 5000);
  } finally {
    await env.core.close();
    await env.cleanup();
    removeDir(home);
  }
});
