// WA-TODO-1: every one-to-one WhatsApp chat comes in (strangers' words and the owner's own to them), each message in
// its place by when it was written, and always within its own account: two WhatsApp lines run here side by side.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const SPAIN = "whatsapp";
const ANDORRA = "whatsapp-second";
const DAN = { phone: "5491100000011@s.whatsapp.net", name: "Dan" };
const EVA = { phone: "5491100000012@s.whatsapp.net", name: "Eva", lid: "200000000000012@lid" };
const FLO = { phone: "5491100000013@s.whatsapp.net", name: "Flo", lid: "200000000000013@lid" };
const GUS = { phone: "5491100000014@s.whatsapp.net", name: "Gus" };
const HUGO = { phone: "5491100000015@s.whatsapp.net", name: "Hugo" };
const GROUP = "120363000000000077@g.us";

const llm = scriptedLlm((_req, { said }) => say(`Got it: ${said}`));
let env: Awaited<ReturnType<typeof startCore>>;
const lines = {
  [SPAIN]: fakeWhatsApp("34600000001@s.whatsapp.net"),
  [ANDORRA]: fakeWhatsApp("376600001@s.whatsapp.net"),
};
const spain = lines[SPAIN];
const andorra = lines[ANDORRA];

const channel = async (id: string) => (await env.client.call("channels.list", {})).channels.find((c) => c.id === id);
const configure = async (id: string, patch: Record<string, unknown>) => {
  await env.client.call("channels.set", { id, channel: { type: "whatsapp", agent_id: "superagent", ...patch } });
  await waitFor(async () => (await channel(id))?.status === "running", `${id} running`);
};
const chats = async (id: string, phone: string) =>
  (await env.client.call("threads.list", {})).threads.filter(
    (t) => t.channel?.id === id && t.channel.conversation === phone,
  );
const words = async (id: string, phone: string) => {
  const [chat] = await chats(id, phone);
  if (!chat) return [];
  return (await env.client.call("threads.get", { thread: chat.id })).messages.map((m) => ({
    own: m.author.kind === "user",
    at: m.created_at,
    text: m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"),
  }));
};
const texts = async (id: string, phone: string) => (await words(id, phone)).map((w) => w.text);
const contact = async (id: string, phone: string) =>
  (await env.client.call("contacts.list", {})).persons.find((p) =>
    p.addresses.some((a) => a.channel === id && a.external_id === phone),
  );
const settle = () => new Promise((r) => setTimeout(r, 200));

before(async () => {
  env = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({
          dir: `${env.home}/wa-${c.id}`,
          selfOwner: false,
          lib: async () => lines[c.id as keyof typeof lines].lib,
          echoWaitMs: 40,
        }),
    },
  });
  // Each line as the owner's are set: nobody unknown is answered; the second one is only read.
  for (const [id, patch] of [
    [SPAIN, { strangers: "ignore" }],
    [ANDORRA, { strangers: "pair", read_only: true }],
  ] as const) {
    await env.client.call("channels.set", { id, channel: { type: "whatsapp", agent_id: "superagent", ...patch } });
    await waitFor(async () => Boolean((await channel(id))?.qr), `a QR for ${id}`);
    lines[id].scan();
    await waitFor(async () => (await channel(id))?.status === "running", `${id} linked`);
  }
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a stranger's words come into a chat of their own even where strangers are not answered: no reply, no code, no turn", async () => {
  const calls = llm.calls.length;
  spain.message(DAN, "hello, are you there?");
  await waitFor(async () => (await texts(SPAIN, DAN.phone)).length === 1, "Dan's chat");
  spain.message(DAN, "second one");
  await waitFor(async () => (await texts(SPAIN, DAN.phone)).length === 2, "Dan's second message");
  await settle();
  assert.deepEqual(await texts(SPAIN, DAN.phone), ["hello, are you there?", "second one"]);
  const dan = await contact(SPAIN, DAN.phone);
  assert.equal(dan?.name, "Dan");
  assert.equal(dan?.muted, true, "kept silenced: the agent answers them no more than before");
  assert.equal(dan?.unreviewed, false, "'ignore' sends the owner no notice");
  assert.deepEqual(spain.textsTo(DAN.phone), [], "nothing was sent to them");
  assert.equal(llm.calls.length, calls, "no turn of the agent");
  assert.equal((await chats(SPAIN, DAN.phone)).length, 1);
});

test("what the owner writes first from the phone opens that chat, and the other side's answer lands in the same one", async () => {
  const calls = llm.calls.length;
  spain.ownerTo({ phone: EVA.phone, name: EVA.name }, "hi Eva, it's me");
  await waitFor(async () => (await texts(SPAIN, EVA.phone)).length === 1, "the chat the owner opened");
  assert.equal((await contact(SPAIN, EVA.phone))?.name, "+5491100000012", "no name yet: only the number is known");
  // Her answer comes under her private id (with the number beside it), then under the private id alone.
  spain.message(EVA, "hey!");
  await waitFor(async () => (await texts(SPAIN, EVA.phone)).length === 2, "her answer");
  spain.message(EVA, "how are you?", { noAlt: true });
  spain.ownerTo(EVA, "all good");
  await waitFor(async () => (await texts(SPAIN, EVA.phone)).length === 4, "the rest of the conversation");
  await settle();
  const said = await words(SPAIN, EVA.phone);
  assert.deepEqual(
    said.map((w) => [w.own, w.text]),
    [
      [true, "hi Eva, it's me"],
      [false, "hey!"],
      [false, "how are you?"],
      [true, "all good"],
    ],
  );
  const eva = await contact(SPAIN, EVA.phone);
  assert.equal(eva?.name, "Eva", "her name came with her first message");
  assert.equal(eva?.muted, true);
  const all = (await env.client.call("threads.list", {})).threads.filter((t) => t.channel?.id === SPAIN);
  assert.equal(all.filter((t) => t.title === "Eva").length, 1, "one chat, not one per address");
  assert.ok(!all.some((t) => t.channel?.conversation === EVA.lid), "none under her private id");
  assert.deepEqual(spain.textsTo(EVA.phone), []);
  assert.equal(llm.calls.length, calls, "the owner's own words never start a turn");
});

test("groups stay out, and so does a chat whose number WhatsApp did not tell", async () => {
  const before = (await env.client.call("threads.list", {})).threads.length;
  const people = (await env.client.call("contacts.list", {})).persons.length;
  spain.message(GUS, "to the whole group", { group: GROUP });
  spain.ownerTo(GUS, "mine to the group", { group: GROUP });
  // Under a private id with no number: opening a chat there would split it from the one under the number.
  spain.ownerTo(FLO, "to someone only known by a private id", { unmapped: true });
  await settle();
  assert.equal((await env.client.call("threads.list", {})).threads.length, before);
  assert.equal((await env.client.call("contacts.list", {})).persons.length, people);
});

test("two accounts: the same person on each is a chat, a contact and a count of messages of each account's own", async () => {
  // The same platform ids are used on both lines (each fake counts from one): never one message for the other.
  andorra.message(DAN, "this is for the other number");
  andorra.ownerTo({ phone: EVA.phone, name: EVA.name }, "written from the second phone");
  await waitFor(async () => (await texts(ANDORRA, DAN.phone)).length === 1, "Dan on the second line");
  await waitFor(async () => (await texts(ANDORRA, EVA.phone)).length === 1, "Eva on the second line");
  await settle();
  assert.deepEqual(await texts(ANDORRA, DAN.phone), ["this is for the other number"]);
  assert.deepEqual(await texts(ANDORRA, EVA.phone), ["written from the second phone"]);
  assert.deepEqual(await texts(SPAIN, DAN.phone), ["hello, are you there?", "second one"], "the first line's chat is as it was");
  assert.equal((await texts(SPAIN, EVA.phone)).length, 4);
  const first = await contact(SPAIN, DAN.phone);
  const second = await contact(ANDORRA, DAN.phone);
  assert.ok(first && second && first.id !== second.id, "a contact per account");
  assert.ok(!first.addresses.some((a) => a.channel === ANDORRA));
  assert.deepEqual(andorra.textsTo(DAN.phone), []);
  assert.deepEqual(spain.textsTo(DAN.phone), []);
});

test("a conversation handed over out of turn shows in the order it was written, with each message's own time", async () => {
  const t0 = Math.floor(Date.now() / 1000) - 600;
  // As after a reconnection: theirs all at once, then the owner's own (which also wait for their echo).
  andorra.message(HUGO, "Hello", { ts: t0 + 10, type: "append" });
  andorra.message(HUGO, "how are you doing?", { ts: t0 + 30, type: "append" });
  andorra.message(HUGO, "thanks", { ts: t0 + 50, type: "append" });
  andorra.ownerTo(HUGO, "Hi!!!", { ts: t0 + 20, type: "append" });
  andorra.ownerTo(HUGO, "Do you agree?", { ts: t0 + 40, type: "append" });
  andorra.ownerTo(HUGO, "Okey nice!", { ts: t0 + 60, type: "append" });
  await waitFor(async () => (await texts(ANDORRA, HUGO.phone)).length === 6, "the six messages");
  // And live, with the other line busy: one more of each, the owner's written first but handed over last.
  andorra.ownerTo(HUGO, "one more thing", { ts: t0 + 70 });
  andorra.message(HUGO, "tell me", { ts: t0 + 80 });
  spain.message(HUGO, "on the other number", { ts: t0 + 5 });
  await waitFor(async () => (await texts(ANDORRA, HUGO.phone)).length === 8, "the live ones");
  await settle();
  const said = await words(ANDORRA, HUGO.phone);
  assert.deepEqual(
    said.map((w) => [w.own, w.text]),
    [
      [false, "Hello"],
      [true, "Hi!!!"],
      [false, "how are you doing?"],
      [true, "Do you agree?"],
      [false, "thanks"],
      [true, "Okey nice!"],
      [true, "one more thing"],
      [false, "tell me"],
    ],
  );
  assert.deepEqual(
    said.map((w) => Date.parse(w.at) / 1000 - t0),
    [10, 20, 30, 40, 50, 60, 70, 80],
    "each one keeps the time it was written, not the time it was handed over",
  );
  assert.deepEqual(await texts(SPAIN, HUGO.phone), ["on the other number"]);
});

test("what a line dropped from strangers before comes back into their chats when it starts again", async () => {
  // Under "pair", a stranger's words handed over late are only kept in the inbox, dropped (PROPIOS-4).
  await configure(SPAIN, { strangers: "pair" });
  spain.message(GUS, "written while it was dropping strangers", { type: "append" });
  spain.message(GUS, "and another", { type: "append" });
  await settle();
  assert.deepEqual(await chats(SPAIN, GUS.phone), [], "dropped: no chat");
  assert.deepEqual(await chats(ANDORRA, GUS.phone), []);
  const calls = llm.calls.length;
  await configure(SPAIN, { strangers: "ignore" });
  await waitFor(async () => (await texts(SPAIN, GUS.phone)).length === 2, "the dropped ones, back");
  assert.deepEqual(await texts(SPAIN, GUS.phone), ["written while it was dropping strangers", "and another"]);
  assert.equal((await contact(SPAIN, GUS.phone))?.muted, true);
  assert.deepEqual(await chats(ANDORRA, GUS.phone), [], "only on the line they wrote to");
  // Once: starting again brings nothing twice.
  await configure(SPAIN, { strangers: "ignore", label: "Spain" });
  await settle();
  assert.equal((await texts(SPAIN, GUS.phone)).length, 2);
  assert.deepEqual(spain.textsTo(GUS.phone), []);
  assert.equal(llm.calls.length, calls);
});
