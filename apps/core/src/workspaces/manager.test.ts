import assert from "node:assert/strict";
import { test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

test("creating a business preserves the current core and starts a separate persistent home", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const original = await env.client.call("system.health", {});
    const { workspace } = await env.client.call("workspaces.create", { name: "Workshop" });
    assert.equal(workspace.name, "Workshop");
    assert.equal(workspace.state, "stopped");
    const snapshot = await env.client.call("workspaces.snapshot", { workspace: workspace.id });
    assert.equal(snapshot.workspace.state, "ready");
    const business = new ColoniaClient({ url: `${env.core.url}/workspaces/${workspace.id}` });
    assert.notEqual((await business.call("system.health", {})).home_id, original.home_id);
    await env.client.call("secrets.set", { name: "business-key", value: "root-private-value" });
    assert.equal(
      (await business.call("secrets.list", {})).secrets.some((secret) => secret.name === "business-key"),
      false,
    );
    await business.call("secrets.set", { name: "business-key", value: "workspace-private-value" });
    assert.equal((await business.call("secrets.reveal", { name: "business-key" })).value, "workspace-private-value");
    assert.equal((await env.client.call("secrets.reveal", { name: "business-key" })).value, "root-private-value");
    const socket = await business.connect();
    try {
      assert.notEqual((await socket.call("system.health", {})).home_id, original.home_id);
    } finally {
      socket.close();
    }
    assert.ok(snapshot.agents.some((agent) => agent.kind === "secretary"));
    assert.equal((await env.client.call("system.health", {})).home_id, original.home_id);
    const renamed = await env.client.call("workspaces.update", { workspace: workspace.id, name: "Studio" });
    assert.equal(renamed.workspace.name, "Studio");
    assert.equal((await env.client.call("workspaces.list", {})).workspaces[0]?.name, "Studio");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("businesses keep separate credentials and resume after the supervisor restarts", async () => {
  let env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const first = (await env.client.call("workspaces.create", { name: "First" })).workspace;
    const second = (await env.client.call("workspaces.create", { name: "Second" })).workspace;
    const business = (id: string) => new ColoniaClient({ url: env.core.url + "/workspaces/" + id });
    await business(first.id).call("secrets.set", { name: "same-key", value: "first-only" });
    await business(second.id).call("secrets.set", { name: "same-key", value: "second-only" });
    const identity = (await business(first.id).call("system.health", {})).home_id;
    const flow = await business(first.id).call("integrations.oauth_start", {
      id: "x",
      values: { client_id: "test-client", client_secret: "test-secret" },
    });
    assert.equal(
      new URL(flow.url).searchParams.get("redirect_uri"),
      env.core.url + "/workspaces/" + first.id + "/oauth/social",
    );
    await env.core.close();
    env = await startCore({ home: env.home, llm: scriptedLlm(() => say("ok")) });
    await waitFor(
      async () => (await env.client.call("workspaces.list", {})).workspaces.every((w) => w.state === "ready"),
      "businesses resume without opening the office",
      { ms: 30000 },
    );
    assert.equal((await business(first.id).call("system.health", {})).home_id, identity);
    assert.equal((await business(first.id).call("secrets.reveal", { name: "same-key" })).value, "first-only");
    assert.equal((await business(second.id).call("secrets.reveal", { name: "same-key" })).value, "second-only");
    assert.equal(
      (await env.client.call("secrets.list", {})).secrets.some((s) => s.name === "same-key"),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("only explicitly paired businesses synchronize through the supervisor", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const a = (await env.client.call("workspaces.create", { name: "Business on server" })).workspace;
    const b = (await env.client.call("workspaces.create", { name: "Business on laptop" })).workspace;
    const address = env.core.url + "/workspaces/" + a.id;
    const first = new ColoniaClient({ url: address });
    const second = new ColoniaClient({ url: env.core.url + "/workspaces/" + b.id });
    await first.call("secrets.set", { name: "paired-business-key", value: "shared-explicitly" });
    const invitation = await first.call("sync.pair_start", {});
    assert.ok(invitation.pairing);
    const code = invitation.pairing.code;
    const wrong = code.replace(/.$/, (c) => (c === "2" ? "3" : "2"));
    await assert.rejects(second.call("sync.pair_join", { code: wrong, address }));
    assert.equal((await second.call("sync.status", {})).paired, false);
    await second.call("sync.pair_join", { code, address });
    await waitFor(
      async () => (await second.call("secrets.list", {})).secrets.some((s) => s.name === "paired-business-key"),
      "the explicitly paired business receives its credential",
      { ms: 30000 },
    );
    assert.equal((await second.call("secrets.reveal", { name: "paired-business-key" })).value, "shared-explicitly");
    assert.equal((await env.client.call("sync.status", {})).paired, false);
    assert.equal(
      (await env.client.call("secrets.list", {})).secrets.some((s) => s.name === "paired-business-key"),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
