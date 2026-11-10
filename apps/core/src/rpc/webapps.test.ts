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
