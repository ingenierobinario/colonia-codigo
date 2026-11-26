import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { z } from "zod";
import { validateSession } from "../channels/whatsapp-session-files.ts";
import { tempDir } from "../testkit/platform.ts";
import { sessionFixture } from "./whatsapp-handoff.test-support.ts";
import { type WhatsAppHandoffMessage, whatsappHandoff } from "./whatsapp-handoff.ts";

type Message = z.infer<typeof WhatsAppHandoffMessage>;
const A = "a".repeat(64);
const B = "b".repeat(64);
const CHANNEL = "whatsapp-sales";
const dirOf = (home: string) => path.join(home, "channels", CHANNEL);
function seed(home: string) {
  fs.mkdirSync(dirOf(home), { recursive: true });
  for (const f of sessionFixture()) fs.writeFileSync(path.join(dirOf(home), f.name), f.text);
}
function setup() {
  const a = tempDir("colonia-wa-source-");
  const b = tempDir("colonia-wa-target-");
  const pending: Array<{ from: string; message: Message }> = [];
  let primary = B;
  let enabled = true;
  const stores = new Map<string, Map<string, string>>();
  const make = (home: string, own: string) => {
    const values = stores.get(own) ?? new Map<string, string>();
    stores.set(own, values);
    return whatsappHandoff({
      home,
      secrets: {
        list: () => [...values.keys()].map((name) => ({ name })),
        resolve: (ref) => values.get(ref.replace("secret://", "")),
        set: (name, value) => {
          if (value === null) values.delete(name);
          else values.set(name, value);
        },
      },
      channels: () => [{ id: CHANNEL, type: "whatsapp", enabled }],
      primary: () => primary === own,
      paired: () => true,
      changed: () => {},
    });
  };
  let left = make(a.path, A);
  let right = make(b.path, B);
  function connect() {
    left.attach({ local: A, peer: B, send: (message) => pending.push({ from: A, message }) });
    right.attach({ local: B, peer: A, send: (message) => pending.push({ from: B, message }) });
  }
  connect();
  async function deliver(dropAck = false) {
    while (pending.length) {
      const entry = pending.shift();
      assert.ok(entry);
      if (dropAck && entry.message.op === "received") continue;
      await (entry.from === A ? right : left).receive(entry.from, entry.message);
    }
  }
  return {
    a,
    b,
    reconnect: connect,
    enable(value: boolean) {
      enabled = value;
    },
    pending,
    get left() {
      return left;
    },
    get right() {
      return right;
    },
    role(value: string) {
      primary = value;
    },
    restart() {
      left = make(a.path, A);
      right = make(b.path, B);
      connect();
    },
    async round(dropAck = false) {
      await left.tick();
      await right.tick();
      await deliver(dropAck);
    },
    deliver,
    async close() {
      await left.close();
      await right.close();
      await a.remove();
      await b.remove();
    },
  };
}

test("a cold linked session moves automatically and only the destination may open it", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  assert.equal(env.right.canStart(CHANNEL), false);
  await env.round();
  await env.round();
  assert.equal(env.right.canStart(CHANNEL), true);
  assert.equal(env.left.canStart(CHANNEL), false);
  assert.equal(fs.existsSync(dirOf(env.a.path)), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirOf(env.b.path), "session-contact.0.json"), "utf8")), {
    ratchet: "initial-state",
  });
  env.role(A);
  assert.equal(env.left.canStart(CHANNEL), false, "a role change cannot resurrect the source session");
});

test("a lost acknowledgement and restart never overwrite the destination's newer keys", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  await env.round(true);
  await env.round(true);
  const evolved = path.join(dirOf(env.b.path), "session-contact.0.json");
  fs.writeFileSync(evolved, JSON.stringify({ ratchet: "new-state" }));
  const escrow = fs.readdirSync(path.join(env.a.path, "whatsapp-handoff")).find((n) => n.endsWith(".sealed"));
  assert.ok(escrow);
  assert.ok(!fs.readFileSync(path.join(env.a.path, "whatsapp-handoff", escrow), "utf8").includes("initial-state"));
  env.restart();
  await env.round();
  assert.deepEqual(JSON.parse(fs.readFileSync(evolved, "utf8")), { ratchet: "new-state" });
  assert.equal(fs.existsSync(path.join(env.a.path, "whatsapp-handoff", escrow)), false);
});

test("returning ownership uses the current keys rather than the old source copy", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  await env.round();
  await env.round();
  fs.writeFileSync(path.join(dirOf(env.b.path), "session-contact.0.json"), JSON.stringify({ ratchet: "evolved" }));
  env.restart();
  env.role(A);
  await env.round();
  await env.round();
  await env.round();
  assert.equal(env.left.canStart(CHANNEL), true);
  assert.equal(env.right.canStart(CHANNEL), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirOf(env.a.path), "session-contact.0.json"), "utf8")), {
    ratchet: "evolved",
  });
});

test("an initialized source or destination is never copied or replaced", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  env.left.starting(CHANNEL);
  await env.round();
  await env.round();
  assert.ok(fs.existsSync(dirOf(env.a.path)));
  assert.equal(fs.existsSync(dirOf(env.b.path)), false);
  env.restart();
  env.right.starting(CHANNEL);
  await env.round();
  await env.round();
  assert.ok(fs.existsSync(dirOf(env.a.path)));
  assert.equal(fs.existsSync(dirOf(env.b.path)), false);
});

test("a cold peer with no session permits linking on the principal", async (t) => {
  const env = setup();
  t.after(env.close);
  assert.equal(env.right.canStart(CHANNEL), false);
  await env.round();
  assert.equal(env.right.canStart(CHANNEL), true);
});

test("an unrelated peer cannot request a linked session", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  await env.left.receive("c".repeat(64), {
    op: "request",
    id: CHANNEL,
    tx: "00000000-0000-4000-8000-000000000001",
    identity: validateSession(sessionFixture()).identity,
  });
  assert.equal(env.pending.length, 0);
  assert.ok(fs.existsSync(dirOf(env.a.path)));
});

test("invalid or unreadable credentials at the destination are not treated as an empty session", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  seed(env.b.path);
  const file = path.join(dirOf(env.b.path), "creds.json");
  fs.writeFileSync(file, "{broken");
  await env.round();
  await assert.rejects(() => env.round());
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
  assert.ok(fs.existsSync(dirOf(env.a.path)));
});

test("session payloads reject traversal, duplicate names and incomplete cryptographic keys", () => {
  assert.throws(() => validateSession([...sessionFixture(), { name: "../creds.json", text: "{}" }]));
  assert.throws(() => validateSession([...sessionFixture(), sessionFixture()[0]]));
  const files = sessionFixture();
  files[0] = {
    name: "creds.json",
    text: JSON.stringify({ me: { id: "example" }, account: {}, signedIdentityKey: { private: true } }),
  };
  assert.throws(() => validateSession(files));
});

test("a directory junction cannot redirect imported credentials outside the home", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  const outside = tempDir("colonia-wa-outside-");
  t.after(() => outside.remove());
  fs.symlinkSync(outside.path, path.join(env.b.path, "channels"), "junction");
  assert.throws(() => env.right.canStart(CHANNEL), /Unsafe/);
  assert.deepEqual(fs.readdirSync(outside.path), []);
});

test("a crash after promoting formatted JSON recovers before acknowledging ownership", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  for (const entry of sessionFixture())
    fs.writeFileSync(path.join(dirOf(env.a.path), entry.name), JSON.stringify(JSON.parse(entry.text), null, 2));
  const rename = fs.renameSync;
  let failed = false;
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (
      !failed &&
      typeof from === "string" &&
      typeof to === "string" &&
      to.endsWith(".json") &&
      to.includes("whatsapp-handoff") &&
      fs.readFileSync(from, "utf8").includes('"phase":"owned"')
    ) {
      failed = true;
      throw new Error("Simulated persistence interruption");
    }
    return rename(from, to);
  });
  await env.round();
  await assert.rejects(() => env.round(), /Simulated persistence interruption/);
  mock.mock.restore();
  assert.equal(env.right.canStart(CHANNEL), false);
  env.restart();
  await env.round();
  assert.equal(env.right.canStart(CHANNEL), true);
  assert.equal(env.left.canStart(CHANNEL), false);
});

test("an older peer retains manual linking and a running session does not reread partially written auth", async (t) => {
  const env = setup();
  t.after(env.close);
  env.right.attach(undefined, false);
  assert.equal(env.right.canStart(CHANNEL), true);
  env.right.starting(CHANNEL);
  seed(env.b.path);
  fs.writeFileSync(path.join(dirOf(env.b.path), "creds.json"), "{");
  assert.equal(env.right.canStart(CHANNEL), true);
});

test("handoff confirmation completes even when synchronization roles change during delivery", async (t) => {
  const env = setup();
  t.after(env.close);
  seed(env.a.path);
  await env.round();
  await env.right.tick();
  const request = env.pending.shift();
  assert.ok(request);
  await env.left.receive(B, request.message);
  env.role(A);
  await env.deliver();
  assert.equal(env.left.canStart(CHANNEL), false);
  assert.equal(env.right.canStart(CHANNEL), true);
  await env.round();
  await env.round();
  assert.equal(env.left.canStart(CHANNEL), true);
  assert.equal(env.right.canStart(CHANNEL), false);
});

for (const interruption of ["pairing", "channel"] as const) {
  test(`an in-flight import stops if its ${interruption} changes, and resumes from its durable receipt`, async (t) => {
    const env = setup();
    t.after(env.close);
    seed(env.a.path);
    const open = fs.promises.open;
    let changed = false;
    const mock = t.mock.method(fs.promises, "open", async (...args: Parameters<typeof fs.promises.open>) => {
      if (!changed && typeof args[0] === "string" && args[0].includes("incoming-")) {
        changed = true;
        if (interruption === "pairing") env.reconnect();
        else env.enable(false);
      }
      return open(...args);
    });
    await env.round();
    await assert.rejects(() => env.round(), /pairing changed/);
    mock.mock.restore();
    assert.equal(env.right.canStart(CHANNEL), false);
    env.enable(true);
    env.restart();
    await env.round();
    assert.equal(env.right.canStart(CHANNEL), true);
    assert.equal(env.left.canStart(CHANNEL), false);
  });
}
