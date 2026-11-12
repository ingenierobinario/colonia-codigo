// Mis equipos: el código de emparejamiento, el canal cifrado, la aprobación en el equipo y, de punta a punta, dos
// Colonia reales (el principal y un «portátil») emparejándose por un socket de verdad.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createCore } from "../server.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { createApproval, readState, writeState } from "./approval.ts";
import { createOpener, createSealer, deriveKeys, newEphemeral, pairProof, sameProof } from "./channel.ts";
import { CODE_TTL_MS, createPairing, MAX_ATTEMPTS } from "./pairing.ts";
import { ToEquipo } from "./wire.ts";

test("el código caduca a los 10 minutos y no vale después", () => {
  let now = 1000;
  const p = createPairing({ clock: () => now, makeCode: () => "123456" });
  p.start();
  now += CODE_TTL_MS - 1;
  assert.equal(p.attempt((c) => c === "123456"), "ok");
  p.start();
  now += CODE_TTL_MS;
  assert.equal(p.attempt((c) => c === "123456"), "expired");
  assert.equal(p.attempt(() => true), "none");
});

test("un código es de un solo uso y se bloquea tras 5 intentos fallidos", () => {
  const p = createPairing({ makeCode: () => "654321" });
  p.start();
  assert.equal(p.attempt((c) => c === "654321"), "ok");
  assert.equal(p.attempt((c) => c === "654321"), "none");
  p.start();
  for (let i = 1; i < MAX_ATTEMPTS; i++) assert.equal(p.attempt(() => false), "wrong");
  assert.equal(p.attempt(() => false), "locked");
  assert.equal(p.attempt((c) => c === "654321"), "none");
});

test("el canal cifrado detecta manipulación, repetición y clave ajena", () => {
  const a = newEphemeral();
  const b = newEphemeral();
  const tr = Buffer.from("transcripcion");
  const ka = deriveKeys(a, b.pub, tr, "client");
  const kb = deriveKeys(b, a.pub, tr, "server");
  const seal = createSealer(ka.send);
  const open = createOpener(kb.receive);
  const m1 = seal(Buffer.from("uno"));
  assert.equal(open(m1).toString(), "uno");
  assert.throws(() => open(m1), "una trama repetida se rechaza");
  const m2 = seal(Buffer.from("dos"));
  const raw = Buffer.from(m2, "base64");
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
  assert.throws(() => open(raw.toString("base64")), "una trama alterada se rechaza");
  const c = newEphemeral();
  const kc = deriveKeys(c, a.pub, tr, "server");
  assert.throws(() => createOpener(kc.receive)(seal(Buffer.from("tres"))));
  assert.ok(sameProof(pairProof("111111", tr, "k"), pairProof("111111", tr, "k")));
  assert.ok(!sameProof(pairProof("111111", tr, "k"), pairProof("111112", tr, "k")));
});

test("la aprobación no lee entorno ni modo desarrollo, y las tramas del principal no llevan campo de aprobación", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-aprob-"));
  const keep = { ...process.env };
  try {
    writeState(home, { id: "e1", name: "x", principal: { url: "http://x", fingerprint: "f", publicKey: "k" }, always: false });
    Object.assign(process.env, {
      NODE_ENV: "development",
      COLONIA_DEV: "1",
      COLONIA_ALLOW_ALL: "1",
      COLONIA_EQUIPO_ALWAYS: "1",
      COLONIA_AUTO_APPROVE: "true",
    });
    const ap = createApproval({ home, timeoutMs: 80 });
    assert.equal(await ap.authorize({ session: "s1", name: "A" }, "ejecutar: x"), false, "sin decisión, se deniega al agotar el plazo");
    const frame = ToEquipo.parse({
      t: "req",
      id: "1",
      who: { session: "s", name: "A" },
      op: { op: "run", command: "x" },
      approved: true,
      always: true,
    });
    assert.ok(!("approved" in frame) && !("always" in frame));
    assert.equal(readState(home)?.always, false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
    await removeDir(home);
  }
});

const TOKEN = "principal-token";
const LAPTOP_TOKEN = "laptop-token";
let principal: Awaited<ReturnType<typeof createCore>>;
let laptop: Awaited<ReturnType<typeof createCore>>;
let pHome = "";
let lHome = "";
let owner: ColoniaClient;
let lap: ColoniaClient;
const notices: string[] = [];

before(async () => {
  pHome = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-eq-p-"));
  lHome = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-eq-l-"));
  const llm = scriptedLlm(() => say("ok"));
  principal = await createCore({ ...testConfig({ home: pHome }), token: TOKEN }, { quiet: true, llm, equipoOff: true });
  laptop = await createCore(
    { ...testConfig({ home: lHome }), token: LAPTOP_TOKEN },
    { quiet: true, llm, equipoNotify: (t, b) => notices.push(`${t}: ${b}`) },
  );
  owner = new ColoniaClient({ url: principal.url, token: TOKEN });
  lap = new ColoniaClient({ url: laptop.url, token: LAPTOP_TOKEN });
});
after(async () => {
  await laptop.close();
  await principal.close();
  await removeDir(pHome);
  await removeDir(lHome);
});

const pairWith = (start: { fingerprint: string }, code: string) =>
  lap.call("equipos.local_pair", { url: principal.url, fingerprint: start.fingerprint, code, name: "Portátil de prueba" });

test("un código equivocado y una huella equivocada no emparejan; 5 fallos anulan el código", async () => {
  const start = await owner.call("equipos.pair_start", {});
  await assert.rejects(pairWith({ fingerprint: "00".repeat(32) }, start.code), /huella/);
  const wrong = start.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < MAX_ATTEMPTS; i++) await assert.rejects(pairWith(start, wrong));
  await assert.rejects(pairWith(start, start.code), "tras 5 fallos ni el código bueno vale");
  assert.equal((await owner.call("equipos.list", {})).equipos.length, 0);
});

test("emparejar, aprobar por sesión, siempre, auditoría y revocación desde el portátil", async () => {
  const start = await owner.call("equipos.pair_start", {});
  assert.match(start.code, /^\d{6}$/);
  await pairWith(start, start.code);
  const listed = await waitFor(
    async () => (await owner.call("equipos.list", {})).equipos.find((e) => e.connected),
    "equipo conectado",
  );
  assert.equal(listed.name, "Portátil de prueba");
  assert.equal(readState(lHome)?.always, false);
  await assert.rejects(pairWith(start, start.code), "el código es de un solo uso");

  await assert.rejects(owner.call("equipos.run", { equipo: listed.id, command: "echo hola" }), "sin acceso activado");
  await owner.call("equipos.set_access", { id: listed.id, enabled: true });

  process.env.NODE_ENV = "development";
  const first = owner.call("equipos.run", { equipo: listed.id, command: "echo hola" });
  let settled = false;
  void first.then(
    () => (settled = true),
    () => (settled = true),
  );
  const pending = await waitFor(async () => (await lap.call("equipos.local_state", {})).pending[0], "petición pendiente");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(settled, false, "sin aprobar en el portátil no se ejecuta, ni en modo desarrollo");
  assert.ok(notices.some((n) => n.includes("pide usar")), "el portátil avisa");
  await lap.call("equipos.local_decide", { id: pending.id, allow: true });
  const out = await first;
  assert.equal(out.exit_code, 0);
  assert.match(out.output, /hola/);

  assert.match((await owner.call("equipos.run", { equipo: listed.id, command: "echo adios" })).output, /adios/, "la misma sesión no pide otra aprobación");

  await lap.call("equipos.local_always", { enabled: true });
  assert.match((await owner.call("equipos.run", { equipo: listed.id, command: "echo siempre" })).output, /siempre/);
  await lap.call("equipos.local_always", { enabled: false });
  const third = owner.call("equipos.run", { equipo: listed.id, command: "echo otra" });
  const p3 = await waitFor(async () => (await lap.call("equipos.local_state", {})).pending[0], "tercera pendiente");
  await lap.call("equipos.local_decide", { id: p3.id, allow: false });
  await assert.rejects(third);
  delete process.env.NODE_ENV;

  const theirs = (await owner.call("equipos.audit", { id: listed.id })).entries.map((e) => e.detail).join("\n");
  assert.match(theirs, /echo hola/);
  const mine = (await lap.call("equipos.local_state", {})).audit.map((e) => e.detail).join("\n");
  assert.match(mine, /echo hola/);
  assert.match(mine, /echo adios/);

  await lap.call("equipos.local_disconnect", {});
  assert.equal(readState(lHome), undefined);
  await waitFor(async () => (await owner.call("equipos.list", {})).equipos.length === 0, "equipo revocado en el principal");
  await assert.rejects(owner.call("equipos.run", { equipo: listed.id, command: "echo nada" }));
});

test("revocar desde el principal borra el emparejamiento del portátil", async () => {
  const start = await owner.call("equipos.pair_start", {});
  await pairWith(start, start.code);
  const e = await waitFor(async () => (await owner.call("equipos.list", {})).equipos.find((x) => x.connected), "conectado");
  await owner.call("equipos.revoke", { id: e.id });
  await waitFor(() => readState(lHome) === undefined, "el portátil olvida el emparejamiento");
  assert.equal((await lap.call("equipos.local_state", {})).paired, false);
});
