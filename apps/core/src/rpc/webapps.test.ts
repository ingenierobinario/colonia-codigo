import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("WEBAPP-1: the sidebar's web apps are added, changed, kept and removed; only http(s) addresses", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const c = env.client;
    assert.deepEqual((await c.call("webapps.list", {})).apps, []);
    await c.call("webapps.set", { id: "bs", app: { name: "Business Stack", url: "https://bs.example.com/" } });
    await c.call("webapps.set", { id: "crm", app: { name: "CRM", url: "https://crm.example.com/" } });
    await c.call("webapps.set", { id: "bs", app: { name: "BS", url: "https://bs.example.com/admin" } });
    assert.deepEqual((await c.call("webapps.list", {})).apps, [
      { id: "bs", name: "BS", url: "https://bs.example.com/admin" },
      { id: "crm", name: "CRM", url: "https://crm.example.com/" },
    ]);
    await assert.rejects(c.call("webapps.set", { id: "x", app: { name: "X", url: "file:///etc/passwd" } }));
    await assert.rejects(c.call("webapps.set", { id: "Bad Id", app: { name: "X", url: "https://x.example/" } }));
    const { apps } = await c.call("webapps.set", { id: "bs", app: null });
    assert.deepEqual(
      apps.map((a) => a.id),
      ["crm"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("WEBAPP-2: an app's connector becomes the owner's MCP server webapp-<id>, its key a variable, gone with the app", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const c = env.client;
    const server = async () => (await c.call("mcp.list", {})).servers.find((s) => s.name === "webapp-bs");
    const app = { name: "BS", url: "https://bs.example.com/", mcp: "https://bs.example.com/mcp" };
    const r = await c.call("webapps.set", { id: "bs", app, key: "bsk_test_key_123456789012" });
    assert.deepEqual(r.keyed, ["bs"]);
    const s = await server();
    assert.ok(s, "the connector is one of the owner's servers");
    assert.equal(s.scope, "global");
    assert.ok(!JSON.stringify(s).includes("bsk_test_key"), "the key never shows, only its reference");
    // Changing the name keeps the key; taking the connector off removes the server and the key.
    assert.deepEqual((await c.call("webapps.set", { id: "bs", app: { ...app, name: "B" } })).keyed, ["bs"]);
    const off = await c.call("webapps.set", { id: "bs", app: { name: "B", url: app.url } });
    assert.deepEqual(off.keyed, []);
    assert.equal(await server(), undefined);
    await c.call("webapps.set", { id: "bs", app, key: "bsk_test_key_123456789012" });
    await c.call("webapps.set", { id: "bs", app: null });
    assert.equal(await server(), undefined);
    assert.deepEqual((await c.call("webapps.list", {})).keyed, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
