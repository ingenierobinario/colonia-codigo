import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeNetworks, META_APP, SOCIAL_CLIENT } from "../integrations/social-testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said.includes("my posts")) return callTool("s1", "social_posts", { network: "x" });
  if (said.includes("announce it"))
    return callTool("s2", "social_publish", { network: "x", text: "We open on Monday" });
  if (said.includes("the bakery page"))
    return callTool("s3", "social_posts", { network: "facebook", account: "Acme Bakery" });
  return say(`tools: ${req.tools.map((t) => t.function.name).join(",")}`);
});
const net = fakeNetworks();
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm, socialFetch: net.fetchImpl });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const offered = () => llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
const lastTool = () => String(llm.calls.at(-1)?.messages.at(-1)?.content ?? "");
const entry = async (id: string) =>
  (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === id);
async function turn(text: string) {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  await env.client.call("threads.send", { thread, text });
  return thread;
}

test("X connects by signing in with the owner's own app; its tools exist only while connected", async () => {
  const x = await entry("x");
  assert.equal(x?.connected, false);
  assert.match(x?.oauth?.redirect_uri ?? "", /^http:\/\/127\.0\.0\.1:\d+\/oauth\/social$/);
  assert.equal(x?.oauth?.builtin, false, "there is no app of Colonia's to offer");
  assert.equal((await entry("youtube"))?.oauth?.builtin, false);
  await env.settle(await turn("hello"));
  assert.ok(!offered().some((n) => n.startsWith("social_")), "nothing before connecting");

  await assert.rejects(env.client.call("integrations.connect", { id: "x", values: {} }), /signing in/);
  await assert.rejects(env.client.call("integrations.oauth_start", { id: "x" }), /client id and the client secret/);
  const { url } = await env.client.call("integrations.oauth_start", { id: "x", values: SOCIAL_CLIENT });
  const { code, state } = net.consent(url);
  await assert.rejects(env.client.call("integrations.oauth_finish", { code, state: `${state}x` }), /not valid/);
  assert.deepEqual(await env.client.call("integrations.oauth_finish", { code, state }), { id: "x", account: "@acme" });

  const on = await entry("x");
  assert.equal(on?.connected, true);
  assert.equal(on?.oauth?.account, "@acme");
  assert.deepEqual(
    on?.fields.map((f) => [f.name, f.value ?? f.set]),
    [
      ["client_id", "acme-client"],
      ["client_secret", true],
    ],
  );
  assert.ok(!JSON.stringify(on).includes(SOCIAL_CLIENT.client_secret), "the client secret never comes back");
  const found = (await env.client.call("integrations.find", { query: "linkedin" })).found.find(
    (f) => f.id === "linkedin",
  );
  assert.equal(found?.connected, false, "an agent can offer the ones not connected yet");

  await env.settle(await turn("hello again"));
  for (const name of ["social_accounts", "social_posts", "social_comments", "social_publish", "social_reply"])
    assert.ok(offered().includes(name), `${name} is offered once connected`);
});

test("posts come back as outside data; publishing waits for the owner's OK", async () => {
  await env.settle(await turn("show my posts"));
  assert.match(lastTool(), /<social posts [^>]*untrusted/);
  assert.match(lastTool(), /"text":"We open on Monday"/);

  const thread = await turn("announce it");
  const pending: Array<{ id: string }> = await inputsOrEnd(env.client, thread);
  assert.equal(net.posted.length, 0, "nothing is posted before the owner says yes");
  await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "approve" });
  await env.settle(thread);
  assert.deepEqual(net.posted, [{ network: "x", body: { text: "We open on Monday" } }]);
  assert.match(lastTool(), /published on X: https:\/\/x\.com\/acme\/status\/2001/);
});

test("Facebook and Instagram connect with the app and a token from Meta's Explorer, kept as Page tokens only", async () => {
  await assert.rejects(env.client.call("integrations.oauth_start", { id: "meta" }), /not found|sign-in/);
  await assert.rejects(
    env.client.call("integrations.connect", { id: "meta", values: { ...META_APP, user_token: "wrong" } }),
    /Invalid OAuth access token/,
  );
  assert.deepEqual(await env.client.call("integrations.connect", { id: "meta", values: META_APP }), {
    connected: true,
  });
  const meta = await entry("meta");
  assert.equal(meta?.connected, true);
  assert.match(meta?.description ?? "", /Connected: Acme Bakery, Northwind\./);
  assert.equal(env.core.secrets.has("secret://meta-page_111"), true);
  assert.equal(env.core.secrets.has("secret://meta-client_secret"), false, "the app secret is used once and not kept");

  await env.settle(await turn("the bakery page"));
  assert.match(lastTool(), /"text":"Fresh bread today"/);
});

test("turned off in a project or disconnected, a network's tools go away", async () => {
  await env.client.call("integrations.disconnect", { id: "meta" });
  assert.equal(env.core.secrets.has("secret://meta-page_111"), false);
  await env.client.call("integrations.disconnect", { id: "x" });
  assert.equal((await entry("x"))?.connected, false);
  assert.equal(env.core.secrets.has("secret://x-refresh_token"), false);
  await env.settle(await turn("hello"));
  assert.ok(!offered().some((n) => n.startsWith("social_")));
});
