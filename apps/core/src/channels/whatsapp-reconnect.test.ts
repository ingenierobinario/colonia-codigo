import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Log } from "../log.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

type Line = { level: string; msg: string; fields: Record<string, unknown> };

/** One linked account: its own session folder, its own states, on a log shared with the other accounts. */
async function account(home: string, id: string, lines: Line[], clock: { t: number }) {
  const fake = fakeWhatsApp();
  const states: string[] = [];
  const codes: string[] = [];
  let observed = clock.t;
  const write = (level: string) => (fields: Record<string, unknown>, msg: string) =>
    void lines.push({ level, msg, fields });
  const log: Log = { info: write("info"), warn: write("warn"), error: write("error") };
  const adapter = whatsappAdapter({
    id,
    dir: path.join(home, "channels", id),
    lib: async () => fake.lib,
    log,
    retryMs: 20,
    historyWaitMs: 60_000,
    now: () => {
      observed = clock.t;
      return clock.t;
    },
    clockLookMs: 2,
  });
  await adapter.start({
    receive() {},
    action() {},
    status: (s, e) => void states.push(e ? `${s}:${e}` : s),
    qr: (c) => void (c && codes.push(c)),
    signal: new AbortController().signal,
  });
  await waitFor(() => codes.length === 1, `${id}: a code to scan`);
  fake.scan();
  await waitFor(() => states.at(-1) === "running", `${id}: linked`);
  return { id, fake, states, adapter, observed: () => observed };
}

const closes = (lines: Line[], id: string) =>
  lines.filter((l) => l.msg === "whatsapp connection closed" && l.fields.channel === id);

// WA-RECONEXION-1: on 13 November both accounts dropped twelve times, each time a second or two after the computer
// woke up, and each time the app showed them as failed with a "link again" button although they were back in seconds.
test("two linked accounts that drop when the computer wakes come back without ever showing as failed", async () => {
  const home = tempDir("colonia-wa-wake-").path;
  const lines: Line[] = [];
  const clock = { t: 1_000_000 };
  const spain = await account(home, "whatsapp", lines, clock);
  const andorra = await account(home, "whatsapp-2", lines, clock);
  try {
    for (const a of [spain, andorra]) a.states.length = 0;
    // The computer sleeps twenty minutes; on waking, the keep-alive of both lines finds them silent.
    clock.t += 20 * 60_000;
    spain.fake.lose();
    andorra.fake.lose();
    for (const a of [spain, andorra]) {
      await waitFor(() => a.states.at(-1) === "running", `${a.id}: back`);
      assert.deepEqual(a.states, ["starting", "running"], `${a.id} never shows as failed`);
      assert.equal(a.fake.sockets, 3, `${a.id} reconnects once, on its own session`);
      const said = closes(lines, a.id);
      assert.equal(said.length, 1, `${a.id}: its close is logged under its own id`);
      assert.equal(said[0]?.level, "info");
      assert.equal(said[0]?.fields.code, 408);
      assert.equal(said[0]?.fields.after_sleep, true);
    }
    assert.equal(
      lines.every((l) => typeof l.fields.channel === "string"),
      true,
      "every line names its account",
    );

    // Later, with the computer awake, one account loses the network: only that one moves, and it is a warning.
    for (let i = 0; i < 10; i++) {
      clock.t += 10_000;
      await waitFor(
        () => spain.observed() === clock.t && andorra.observed() === clock.t,
        "ambas cuentas observan el reloj",
      );
    }
    for (const a of [spain, andorra]) a.states.length = 0;
    andorra.fake.lose();
    await waitFor(() => andorra.states.at(-1) === "running", "the second account: back");
    assert.deepEqual(andorra.states, ["starting", "running"]);
    assert.deepEqual(spain.states, [], "the other account is not touched");
    assert.equal(closes(lines, "whatsapp").length, 1);
    assert.equal(closes(lines, "whatsapp-2").at(-1)?.level, "warn");
    assert.equal(closes(lines, "whatsapp-2").at(-1)?.fields.after_sleep, false);
  } finally {
    await spain.adapter.stop();
    await andorra.adapter.stop();
    await removeDir(home);
  }
});

test("a linked account that does not come back shows as failed, keeps trying and recovers by itself", async () => {
  const home = tempDir("colonia-wa-down-").path;
  const lines: Line[] = [];
  const clock = { t: 1_000_000 };
  const spain = await account(home, "whatsapp", lines, clock);
  const andorra = await account(home, "whatsapp-2", lines, clock);
  try {
    for (const a of [spain, andorra]) a.states.length = 0;
    spain.fake.unreachable.value = true;
    spain.fake.lose();
    await waitFor(() => spain.states.length >= 3, "the failure said");
    assert.equal(spain.states[0], "starting");
    assert.equal(spain.states[1], "error:WhatsApp disconnected: Connection was lost");
    assert.equal(closes(lines, "whatsapp").at(-1)?.level, "warn");
    spain.fake.unreachable.value = false;
    await waitFor(() => spain.states.at(-1) === "running", "back once WhatsApp answers");
    assert.deepEqual(andorra.states, [], "the other account stayed up");
    // Recovered: the next drop starts from the beginning, not as a failure.
    spain.states.length = 0;
    spain.fake.lose();
    await waitFor(() => spain.states.at(-1) === "running", "back again");
    assert.deepEqual(spain.states, ["starting", "running"]);
  } finally {
    await spain.adapter.stop();
    await andorra.adapter.stop();
    await removeDir(home);
  }
});
