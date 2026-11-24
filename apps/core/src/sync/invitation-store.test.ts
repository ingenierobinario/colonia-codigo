import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createPairing } from "../equipos/pairing.ts";
import { tempDir } from "../testkit/platform.ts";
import { invitationStore } from "./invitation-store.ts";

test("restarting preserves the invitation deadline and failed attempts", async (t) => {
  const home = tempDir("colonia-invitation-");
  t.after(() => home.remove());
  let now = 1000;
  const boot = () => {
    const pairing = createPairing({ clock: () => now });
    const invitation = pairing.start({ code: "ABCD2345", ttlMs: 100, store: invitationStore(home.path, "preset") });
    return { pairing, invitation };
  };
  const first = boot();
  for (let i = 0; i < 4; i++)
    assert.equal(
      first.pairing.attempt(() => false),
      "wrong",
    );
  now += 50;
  const restarted = boot();
  assert.equal(restarted.invitation.expiresAt, first.invitation.expiresAt);
  assert.equal(
    restarted.pairing.attempt(() => false),
    "locked",
  );
  assert.equal(
    boot().pairing.attempt(() => true),
    "locked",
  );
  assert.equal(boot().pairing.active(), false);
});

test("expired, consumed and cancelled invitations cannot be revived by restarting", async (t) => {
  const home = tempDir("colonia-invitation-");
  t.after(() => home.remove());
  let now = 1000;
  const boot = (code: string) => {
    const pairing = createPairing({ clock: () => now });
    pairing.start({ code, ttlMs: 100, store: invitationStore(home.path, "log") });
    return pairing;
  };
  boot("ABCD2345");
  now += 101;
  assert.equal(
    boot("ABCD2345").attempt(() => true),
    "expired",
  );
  assert.equal(
    boot("BCDE2345").attempt(() => true),
    "ok",
  );
  assert.equal(
    boot("BCDE2345").attempt(() => true),
    "locked",
  );
  assert.equal(boot("CDEF2345").cancel(), true);
  assert.equal(
    boot("CDEF2345").attempt(() => true),
    "locked",
  );
  assert.equal(
    boot("DEFG2345").attempt(() => true),
    "ok",
  );
});

test("replacing an invitation also invalidates its persisted code", async (t) => {
  const home = tempDir("colonia-invitation-");
  t.after(() => home.remove());
  const store = invitationStore(home.path, "preset");
  const first = createPairing({ clock: () => 1000 });
  first.start({ code: "ABCD2345", ttlMs: 10000, store });
  first.start();
  const restarted = createPairing({ clock: () => 1000 });
  restarted.start({ code: "ABCD2345", ttlMs: 10000, store });
  assert.equal(restarted.active(), false);
});

test("invitation persistence contains no code and fails closed on damaged state", async (t) => {
  const home = tempDir("colonia-invitation-");
  t.after(() => home.remove());
  const store = invitationStore(home.path, "preset");
  store.write("ABCD2345", { expires: 1100, misses: 4, used: false });
  const file = path.join(home.path, "sync-invitation-preset.json");
  assert.ok(!fs.readFileSync(file, "utf8").includes("ABCD2345"));
  fs.writeFileSync(file, "{}");
  assert.throws(() => createPairing().start({ code: "ABCD2345", ttlMs: 100, store }));
});
