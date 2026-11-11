import assert from "node:assert/strict";
import { after, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createSecrets } from "../secrets.ts";
import type { Run } from "../secrets-stores.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import type { ChannelAdapter } from "./types.ts";
import { ChannelRefused } from "./types.ts";

// A desktop keyring (secret-tool) that answers nothing while it is locked, the way one does at boot before the login.
const kept = new Map<string, string>();
let locked = false;
const ring: Run = (_cmd, args, o) => {
  const key = args.at(-1) as string;
  if (locked) throw new Error("locked");
  if (args[0] === "store") kept.set(key, o?.input ?? "");
  if (args[0] === "clear") kept.delete(key);
  if (args[0] === "lookup") {
    if (!kept.has(key)) throw new Error("not found");
    return kept.get(key) as string;
  }
  return "";
};
let starts = 0;
const adapter = (token: string | undefined): ChannelAdapter => ({
  caps: { typing: false, buttons: false },
  async start() {
    starts++;
    if (!token) throw new ChannelRefused("needs its token");
    return { account: "@bot" };
  },
  async stop() {},
  async send() {
    return {};
  },
});

const home = tempDir("colonia-keyring-wait-");
const boot = () =>
  startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    secrets: createSecrets(home.path, "secret-service", {}, ring),
    channelAdapters: { telegram: (_c, token) => adapter(token) },
    channelRetryMs: [20, 40],
  });
let env: Awaited<ReturnType<typeof startCore>>;
after(async () => {
  await env?.core.close();
  home.remove();
});

const info = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");

test("a channel whose saved token the locked keyring does not give yet waits for it, then starts by itself", async () => {
  env = await boot();
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "superagent" }, token: "123456:TEST" });
  await waitFor(async () => (await info())?.status === "running");
  await env.core.close();
  // The machine boots and the core starts before anyone logs in to unlock the keyring.
  locked = true;
  starts = 0;
  env = await boot();
  await waitFor(async () => (await info())?.status === "error");
  assert.match((await info())?.error ?? "", /keyring is locked/);
  assert.equal(starts, 0, "the adapter is not asked to start without its token");
  locked = false;
  await waitFor(async () => (await info())?.status === "running");
});
