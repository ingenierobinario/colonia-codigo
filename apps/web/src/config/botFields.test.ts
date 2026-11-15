import assert from "node:assert/strict";
import { test } from "node:test";
import { newAccountId } from "../data/accounts.ts";
import { BOTS, type BotKind, botSecret, discordInvite, pasted, randomTopic } from "./botFields.ts";

const secret = (kind: BotKind, ...values: string[]) => botSecret(BOTS[kind].tokens, values);
/** The fields the owner has to fill before anything connects: the ones not under "More options". */
const asked = (kind: BotKind) => BOTS[kind].tokens.filter((s) => !s.advanced && !s.initial).length;

test("pasting BotFather's whole message leaves only the bot's code", () => {
  const [spec] = BOTS.telegram.tokens;
  assert.ok(spec);
  const message =
    "Done! Congratulations on your new bot.\nUse this token to access the HTTP API:\n123456789:AAExampleExampleExampleExample_0123-ab\nKeep your token secure.";
  assert.equal(pasted(spec, message), "123456789:AAExampleExampleExampleExample_0123-ab");
  assert.equal(secret("telegram", pasted(spec, message)).ok, true);
  // Typing by hand is left as typed: nothing to pull out yet.
  assert.equal(pasted(spec, "1234"), "1234");
});

test("what each kind asks for before it connects is the least its platform allows", () => {
  assert.deepEqual(
    Object.fromEntries((Object.keys(BOTS) as BotKind[]).map((k) => [k, asked(k)])),
    // biome-ignore format: one kind a line reads as a table.
    {
      telegram: 1, discord: 1, slack: 2, matrix: 2, mattermost: 2, signal: 1, googlechat: 2, sms: 3,
      ntfy: 0, nextcloud: 2, irc: 2, twitch: 2, teams: 3, line: 2,
    },
  );
});

test("ntfy connects with the topic it opens with: the public server unless another is given", () => {
  const topic = randomTopic((b) => b.fill(7));
  assert.match(topic, /^colonia-[a-z2-9]{16}$/);
  assert.notEqual(randomTopic(), randomTopic());
  assert.deepEqual(secret("ntfy", topic), { ok: true, joined: `${topic} https://ntfy.sh` });
  assert.deepEqual(secret("ntfy", "acme-topic", "https://ntfy.example.org", "tk_abc"), {
    ok: true,
    joined: "acme-topic https://ntfy.example.org tk_abc",
  });
  assert.equal(secret("ntfy", "bad topic").ok, false);
});

test("Signal asks for the number alone; the program's address is the usual one unless changed", () => {
  assert.deepEqual(secret("signal", "+15550001111"), { ok: true, joined: "+15550001111 http://127.0.0.1:8080" });
  assert.equal(secret("signal", "+15550001111", "http://127.0.0.1:9090").joined, "+15550001111 http://127.0.0.1:9090");
  assert.equal(secret("signal", "15550001111").ok, false);
});

test("Matrix takes the user and its password; a server only when the owner writes one", () => {
  assert.deepEqual(secret("matrix", "@colonia:example.org", "s3cret"), {
    ok: true,
    joined: "@colonia:example.org s3cret",
  });
  assert.equal(
    secret("matrix", "@colonia:example.org", "s3cret", "https://matrix.example.org").joined,
    "@colonia:example.org s3cret https://matrix.example.org",
  );
  assert.equal(secret("matrix", "colonia", "s3cret").ok, false);
});

test("Nextcloud reads the server from the bot's address", () => {
  assert.deepEqual(secret("nextcloud", "colonia-bot@cloud.example.org", "abcde-fghij"), {
    ok: true,
    joined: "https://cloud.example.org colonia-bot abcde-fghij",
  });
  assert.equal(secret("nextcloud", "colonia-bot", "abcde-fghij").ok, false);
});

test("IRC takes a network as people write it; Twitch reads in the bot's own chat unless another is named", () => {
  assert.equal(secret("irc", "irc.libera.chat", "acme-bot").joined, "ircs://irc.libera.chat acme-bot");
  assert.equal(
    secret("irc", "irc://irc.example.org:6667", "acme-bot", "pw").joined,
    "irc://irc.example.org:6667 acme-bot pw",
  );
  const code = "a".repeat(30);
  assert.deepEqual(secret("twitch", "acme_bot", code), { ok: true, joined: `acme_bot ${code} #acme_bot` });
  assert.equal(secret("twitch", "acme_bot", code, "#acme").joined, `acme_bot ${code} #acme`);
});

test("the link that adds a Discord bot to a server comes from its code", () => {
  const code = `${btoa("123456789012345678").replace(/=+$/, "")}.GabcDE.${"x".repeat(27)}`;
  assert.equal(
    discordInvite(code),
    "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=117760",
  );
  assert.equal(discordInvite("not-a-code"), undefined);
  assert.equal(discordInvite(""), undefined);
});

test("two accounts of one kind keep their own id and their own secret", () => {
  // MULTI-CUENTA-1: the second Matrix account never takes the first one's id, so connecting it cannot overwrite it.
  const first = newAccountId("matrix", []);
  const second = newAccountId("matrix", [first]);
  assert.equal(first, "matrix");
  assert.notEqual(second, first);
  assert.match(second, /^matrix-/);
  const stored = new Map([
    [`channel-${first}`, secret("matrix", "@one:example.org", "pw-one").joined],
    [`channel-${second}`, secret("matrix", "@two:example.org", "pw-two").joined],
  ]);
  assert.deepEqual([...stored.values()], ["@one:example.org pw-one", "@two:example.org pw-two"]);
});
