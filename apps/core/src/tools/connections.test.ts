import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type Connectable, findConnectable } from "../integrations/find.ts";

const TOKEN = "123456:TEST-connect";

// Each owner message names what the scripted model looks for; the tool's result comes back as the answer.
const QUERIES: Record<string, { query: string; why?: string }> = {
  "open my figma file": { query: "figma", why: "To read the Acme design file." },
  "message the team on whatsapp": { query: "whatsapp" },
  "tell me on telegram": { query: "telegram" },
  "fax it": { query: "fax machine" },
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const q = QUERIES[said];
  if (said === "what apps do I have") return callTool("c1", "list_apps", {});
  return q ? callTool("c1", "suggest_connection", q) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", label: "Acme bot", agent_id: "superagent", strangers: "ask", research: "off" },
    token: TOKEN,
  });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

async function ask(text: string) {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Connect" });
  await env.client.call("threads.send", { thread: thread.id, text });
  const { messages } = await env.settle(thread.id);
  const parts = messages.at(-1)?.parts ?? [];
  return {
    answer: parts.find((p) => p.type === "text")?.text ?? "",
    card: parts.find((p) => p.type === "connect"),
  };
}

test("an app that is not connected is offered on a card in the chat", async () => {
  const { answer, card } = await ask("open my figma file");
  assert.match(answer, /card to connect: Figma \(integration\)/);
  assert.deepEqual(card, {
    type: "connect",
    why: "To read the Acme design file.",
    offers: [
      {
        kind: "integration",
        id: "figma",
        label: "Figma",
        description: "Designs and their components, as code context.",
      },
    ],
  });
});

test("a channel that is not set up is offered too", async () => {
  const { answer, card } = await ask("message the team on whatsapp");
  assert.match(answer, /WhatsApp \(channel\).*Settings › Channels/);
  assert.equal(card?.type === "connect" && card.offers[0]?.id, "whatsapp");
});

test("one already connected gets no card: the agent is told to use it", async () => {
  const { answer, card } = await ask("tell me on telegram");
  assert.match(answer, /Telegram \(channel\) is already connected/);
  assert.equal(card, undefined);
});

test("nothing Colonia connects: no card, and the agent hears so", async () => {
  const { answer, card } = await ask("fax it");
  assert.match(answer, /Nothing Colonia connects matches/);
  assert.equal(card, undefined);
});

test("integrations.find gives names, descriptions and whether each is connected", async () => {
  const { found } = await env.client.call("integrations.find", { query: "telegram" });
  assert.deepEqual(found[0], {
    kind: "channel",
    id: "telegram",
    label: "Telegram",
    description: "A Telegram bot to chat with your agents and get their messages.",
    connected: true,
  });
});

const entry = (id: string, label: string, description: string, connected = false): Connectable => ({
  kind: "integration",
  id,
  label,
  description,
  connected,
});
const POOL = [
  entry("figma", "Figma", "Designs and their components."),
  entry("canva", "Canva", "Designs: find, create and export them."),
  entry("gmail", "Gmail", "Search and read your mail.", true),
  { ...entry("email", "Email", "A mailbox: it answers by email."), kind: "channel" as const },
];

test("a name wins over descriptions, and a connected one comes first on a tie", () => {
  assert.deepEqual(
    findConnectable(POOL, "figma designs").map((c) => c.id),
    ["figma"],
  );
  assert.deepEqual(
    findConnectable(POOL, "design").map((c) => c.id),
    ["figma", "canva"],
  );
  assert.deepEqual(
    findConnectable(POOL, "send a mail").map((c) => c.id),
    ["gmail", "email"],
  );
  assert.deepEqual(findConnectable(POOL, "the of my"), []);
});

test("WEBAPP-3: list_apps shows the owner's web apps, with their connector, and the other connectors", async () => {
  await env.client.call("webapps.set", { id: "bs", app: { name: "Business Stack", url: "https://bs.example.com/" } });
  await env.client.call("webapps.set", {
    id: "crm",
    app: { name: "CRM", url: "https://crm.example.com/", mcp: "https://crm.example.com/mcp" },
  });
  await env.client.call("mcp.set", { name: "railway", server: { url: "https://mcp.railway.com" } });
  const { answer } = await ask("what apps do I have");
  assert.match(answer, /- Business Stack \(app: bs\) · https:\/\/bs\.example\.com\/\n/);
  assert.match(answer, /- CRM \(app: crm\) · https:\/\/crm\.example\.com\/ · connector: mcp_search server webapp-crm/);
  assert.match(answer, /Connectors[^\n]*\n- railway$/m);
  assert.doesNotMatch(answer, /^- webapp-crm$/m, "an app's own connector is listed with the app, not twice");
});
