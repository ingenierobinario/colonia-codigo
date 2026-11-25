import assert from "node:assert/strict";
import { test } from "node:test";
import { ColoniaClient, ColoniaError } from "@colonia/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { tempDir } from "../testkit/platform.ts";

test("workspace transport rejects anonymous and app access and preserves device restrictions and revocation", async () => {
  const home = tempDir("colonia-business-security-");
  const token = "test-supervisor-owner";
  const core = await createCore(
    { ...testConfig({ home: home.path }), token },
    { quiet: true, llm: scriptedLlm(() => say("ok")) },
  );
  try {
    const root = new ColoniaClient({ url: core.url, token });
    const { workspace } = await root.call("workspaces.create", { name: "Private business" });
    const url = `${core.url}/workspaces/${workspace.id}`;
    const anonymous = new ColoniaClient({ url });
    const unauthorized = (error: unknown) => error instanceof ColoniaError && error.code === "unauthorized";
    await assert.rejects(anonymous.call("agents.list", {}), unauthorized);
    await assert.rejects(anonymous.connect());
    assert.equal((await root.call("workspaces.list", {})).workspaces[0]?.state, "stopped");
    const app = await root.call("clients.create", { name: "Outside app", scopes: ["chat"] });
    await assert.rejects(new ColoniaClient({ url, clientToken: app.token }).call("agents.list", {}), unauthorized);
    await assert.rejects(new ColoniaClient({ url, token: app.token }).connect());
    await assert.rejects(
      anonymous.call("integrations.oauth_finish", { code: "not-a-code", state: "forged-state" }),
      (error: unknown) => error instanceof ColoniaError && error.code === "bad_request",
    );
    const device = core.store.devices.create("Owner phone", "other");
    const panel = new ColoniaClient({ url, token: device.token, socketAuth: "subprotocol" });
    const socket = await panel.connect();
    try {
      await assert.rejects(panel.call("devices.set_push", { id: "some-other-device", push: null }), unauthorized);
      await assert.rejects(socket.call("devices.set_push", { id: "some-other-device", push: null }), unauthorized);
      assert.ok((await socket.call("agents.list", {})).agents.length);
      await root.call("devices.revoke", { id: device.device.id });
      await assert.rejects(panel.call("agents.list", {}), unauthorized);
      await assert.rejects(socket.call("agents.list", {}));
      await assert.rejects(panel.connect());
    } finally {
      socket.close();
    }
    const foreign = await fetch(`${url}/rpc/agents.list`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://foreign.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
  } finally {
    await core.close();
    await home.remove();
  }
});
