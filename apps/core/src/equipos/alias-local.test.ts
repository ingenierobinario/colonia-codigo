// EQUIPOS-ALIAS-1 y ESTE-EQUIPO-1 · El nombre que el dueño le pone a un equipo y el ordenador donde corre Colonia como
// primera entrada. El `ssh` del sistema, la búsqueda en la red y «qué ordenador es este» se cambian por dobles.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { THIS_EQUIPO_ID } from "@colonia/protocol";
import { ColoniaClient } from "@colonia/protocol/client";
import { testConfig } from "../config.ts";
import { openDb } from "../db/db.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { isThisComputer } from "../rpc/equipos.ts";
import { createSecrets } from "../secrets.ts";
import { createCore } from "../server.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { equipoTools } from "../tools/equipos.ts";
import { thisComputer } from "./local.ts";
import { createSshEquipos, type SshExec } from "./ssh.ts";

const TOKEN = "dueno-token";
const HOSTS: Record<string, string> = { "192.168.1.40": "DESKTOP-ACME01", "192.168.1.41": "salon-pc" };
const fakeSsh: SshExec = async (t, command) => {
  if (command.startsWith("hostname"))
    return { code: 0, stdout: Buffer.from(`${HOSTS[t.host] ?? t.host}\nLinux\n`), stderr: "", timedOut: false };
  return { code: 0, stdout: Buffer.from(`hecho: ${command}`), stderr: "", timedOut: false };
};
const found = (name: string, ip: string) => ({
  name,
  ip,
  os: "linux/mac" as const,
  via: "red" as const,
  online: true,
  ports: [22],
  opens: ["Terminal"],
});

let home: string;
let core: Awaited<ReturnType<typeof createCore>>;
let owner: ColoniaClient;
const boot = () =>
  createCore(
    { ...testConfig({ home }), token: TOKEN },
    {
      quiet: true,
      llm: scriptedLlm(() => say("ok")),
      equipoOff: true,
      equipoSsh: createSshEquipos({ secrets: createSecrets(home, "file"), exec: fakeSsh }),
      equipoLocal: () => ({ hostname: "oficina-pc", platform: "win32", addresses: ["192.168.1.20", "100.64.0.7"] }),
      equipoDiscover: async () => ({
        tailscale: true,
        equipos: [
          found("DESKTOP-ACME01", "192.168.1.40"),
          found("oficina-pc", "192.168.1.20"),
          found("oficina-pc", "100.64.0.7"),
        ],
      }),
    },
  );

before(async () => {
  home = tempDir("colonia-eq-alias-").path;
  core = await boot();
  owner = new ColoniaClient({ url: core.url, token: TOKEN });
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("ESTE-EQUIPO-1: la lista trae este ordenador aparte, con nombre, sistema y direcciones, sin equipos conectados", async () => {
  const r = await owner.call("equipos.list", {});
  assert.deepEqual(r.equipos, []);
  assert.deepEqual(r.local, {
    name: "oficina-pc",
    hostname: "oficina-pc",
    platform: "windows",
    addresses: ["192.168.1.20", "100.64.0.7"],
  });
});

test("ESTE-EQUIPO-1: la búsqueda en la red no ofrece este mismo ordenador por ninguna de sus direcciones", async () => {
  const r = await owner.call("equipos.discover", {});
  assert.deepEqual(
    r.equipos.map((e) => e.ip),
    ["192.168.1.40"],
  );
});

test("ESTE-EQUIPO-1: isThisComputer reconoce sus direcciones, su nombre y el propio ordenador, y nada más", () => {
  const l = { hostname: "Oficina-PC", platform: "win32", addresses: ["192.168.1.20"] };
  const yes = ["192.168.1.20", "localhost", "127.0.0.1", "127.0.1.1", "::1", "oficina-pc", "OFICINA-PC.local"];
  for (const a of [...yes, " 192.168.1.20 "]) assert.equal(isThisComputer(a, l), true, a);
  for (const a of [undefined, "", "192.168.1.2", "192.168.1.200", "oficina-pc2", "otro"])
    assert.equal(isThisComputer(a, l), false, String(a));
  assert.equal(isThisComputer("", { hostname: "", platform: "linux", addresses: [] }), false);
});

test("ESTE-EQUIPO-1: thisComputer da las direcciones de casa primero y calla las internas y las que no sirven", () => {
  const i = (address: string, internal = false, family = "IPv4") =>
    ({ address, internal, family, netmask: "", mac: "", cidr: null }) as never;
  const l = thisComputer({
    hostname: () => "oficina-pc",
    platform: "linux",
    interfaces: () => ({
      lo: [i("127.0.0.1", true)],
      ts: [i("100.64.0.7")],
      eth: [i("192.168.1.20"), i("fe80::1", false, "IPv6")],
      apipa: [i("169.254.3.4")],
      dup: [i("192.168.1.20")],
    }),
  });
  assert.deepEqual(l, { hostname: "oficina-pc", platform: "linux", addresses: ["192.168.1.20", "100.64.0.7"] });
});

test("EQUIPOS-ALIAS-1: renombrar guarda el nombre, deja el del equipo a la vista y vaciarlo lo devuelve", async () => {
  const e = await owner.call("equipos.connect", { host: "192.168.1.40", user: "ana", password: "buena" });
  assert.equal(e.name, "DESKTOP-ACME01");
  assert.equal(e.hostname, "DESKTOP-ACME01");
  assert.equal(e.alias, undefined);
  const r = await owner.call("equipos.rename", { id: e.id, alias: "  Portátil   de\nMarta " });
  assert.deepEqual(r, { name: "Portátil de Marta", hostname: "DESKTOP-ACME01", alias: "Portátil de Marta" });
  const [listed] = (await owner.call("equipos.list", {})).equipos;
  assert.equal(listed?.name, "Portátil de Marta");
  assert.equal(listed?.hostname, "DESKTOP-ACME01");
  assert.equal(listed?.alias, "Portátil de Marta");
  assert.equal(listed?.address, "192.168.1.40");
  const audit = (await owner.call("equipos.audit", { id: e.id })).entries;
  assert.ok(audit.some((a) => a.kind === "renombrado" && a.detail.includes("Portátil de Marta")));
  const back = await owner.call("equipos.rename", { id: e.id, alias: "   " });
  assert.deepEqual(back, { name: "DESKTOP-ACME01", hostname: "DESKTOP-ACME01" });
  const [again] = (await owner.call("equipos.list", {})).equipos;
  assert.equal(again?.name, "DESKTOP-ACME01");
  assert.equal(again?.alias, undefined);
});

test("EQUIPOS-ALIAS-1: un nombre larguísimo se corta y un equipo que no existe da error", async () => {
  const [e] = (await owner.call("equipos.list", {})).equipos;
  assert.ok(e);
  const r = await owner.call("equipos.rename", { id: e.id, alias: "x".repeat(150) });
  assert.equal(r.alias?.length, 60);
  await assert.rejects(owner.call("equipos.rename", { id: e.id, alias: "x".repeat(201) }));
  await assert.rejects(owner.call("equipos.rename", { id: "eqp_no_existe", alias: "Otro" }));
  await owner.call("equipos.rename", { id: e.id, alias: "" });
});

test("EQUIPOS-ALIAS-1: los agentes ven el nombre puesto por el dueño y lo usan; el del equipo sigue valiendo", async () => {
  const [e] = (await owner.call("equipos.list", {})).equipos;
  assert.ok(e);
  await owner.call("equipos.rename", { id: e.id, alias: "Portátil de Marta" });
  await assert.rejects(
    owner.call("equipos.run", { equipo: "portátil de marta", command: "uptime" }),
    /«Portátil de Marta» está desactivado/,
  );
  await owner.call("equipos.set_access", { id: e.id, enabled: true });
  for (const ref of ["Portátil de Marta", "portátil de marta", "DESKTOP-ACME01", e.id]) {
    const r = await owner.call("equipos.run", { equipo: ref, command: "uptime" });
    assert.match(r.output, /hecho: uptime/, ref);
  }
  await assert.rejects(owner.call("equipos.run", { equipo: "nadie", command: "uptime" }), /son: Portátil de Marta/);
  const list = equipoTools().find((t) => t.name === "equipo_list");
  assert.ok(list);
  const ctx = { call: (m: "equipos.list", p: Record<string, never>) => owner.call(m, p) };
  assert.equal(await list.run({}, ctx as never), "Portátil de Marta (DESKTOP-ACME01, linux) - connected");
});

test("EQUIPOS-ALIAS-1: dos equipos no pueden llamarse igual, ni por el nombre puesto ni por el del equipo", async () => {
  const b = await owner.call("equipos.connect", { host: "192.168.1.41", user: "ana", password: "buena" });
  assert.equal(b.name, "salon-pc");
  await assert.rejects(owner.call("equipos.rename", { id: b.id, alias: "portátil de MARTA" }), /otro equipo/);
  await assert.rejects(owner.call("equipos.rename", { id: b.id, alias: "desktop-acme01" }), /otro equipo/);
  await assert.rejects(owner.call("equipos.rename", { id: THIS_EQUIPO_ID, alias: "salon-pc" }), /otro equipo/);
  // El suyo propio sí: ponerle como nombre el que ya tiene no choca con nadie.
  assert.equal((await owner.call("equipos.rename", { id: b.id, alias: "Salon-PC" })).alias, "Salon-PC");
  assert.equal((await owner.call("equipos.revoke", { id: b.id })).revoked, true);
});

test("EQUIPOS-ALIAS-1 + ESTE-EQUIPO-1: este ordenador también se renombra, y todo sigue ahí tras reiniciar", async () => {
  const r = await owner.call("equipos.rename", { id: THIS_EQUIPO_ID, alias: "Sobremesa de la oficina" });
  assert.deepEqual(r, { name: "Sobremesa de la oficina", hostname: "oficina-pc", alias: "Sobremesa de la oficina" });
  await core.close();
  core = await boot();
  owner = new ColoniaClient({ url: core.url, token: TOKEN });
  const after = await owner.call("equipos.list", {});
  assert.equal(after.local?.name, "Sobremesa de la oficina");
  assert.equal(after.local?.hostname, "oficina-pc");
  assert.deepEqual(
    after.equipos.map((e) => [e.name, e.hostname, e.local]),
    [["Portátil de Marta", "DESKTOP-ACME01", undefined]],
  );
  const cleared = await owner.call("equipos.rename", { id: THIS_EQUIPO_ID, alias: "" });
  assert.deepEqual(cleared, { name: "oficina-pc", hostname: "oficina-pc" });
  assert.equal((await owner.call("equipos.list", {})).local?.alias, undefined);
});

test("ESTE-EQUIPO-1: una conexión hecha a este mismo ordenador se marca para no enseñarlo dos veces", async () => {
  const e = await owner.call("equipos.connect", { host: "192.168.1.20", user: "ana", password: "buena" });
  assert.equal(e.local, true);
  const r = await owner.call("equipos.list", {});
  assert.deepEqual(
    r.equipos.map((x) => [x.address, x.local]),
    [
      ["192.168.1.40", undefined],
      ["192.168.1.20", true],
    ],
  );
  await owner.call("equipos.revoke", { id: e.id });
});

test("EQUIPOS-ALIAS-1: una fila de equipo escrita como antes, sin nombre puesto, se sigue leyendo", async () => {
  const old = tempDir("colonia-eq-alias-old-").path;
  const db = openDb(old, {});
  try {
    const cols = db.prepare("PRAGMA table_info(team_computers)").all() as Array<{ name: string; notnull: number }>;
    const alias = cols.find((c) => c.name === "alias");
    assert.deepEqual({ name: alias?.name, notnull: alias?.notnull }, { name: "alias", notnull: 0 });
    db.prepare(
      "INSERT INTO team_computers (id, name, platform, public_key, agent_access, created_at) VALUES ('eqp_viejo', 'viejo-pc', 'linux', '', 0, '2025-01-01T00:00:00.000Z')",
    ).run();
    const row = db.prepare("SELECT name, alias FROM team_computers WHERE id = 'eqp_viejo'").get() as {
      name: string;
      alias: string | null;
    };
    assert.deepEqual({ ...row }, { name: "viejo-pc", alias: null });
  } finally {
    db.close();
    await removeDir(old);
  }
});
