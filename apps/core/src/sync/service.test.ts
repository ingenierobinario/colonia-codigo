// D-192 fase 2 · Dos equipos de verdad (dos bases, dos servidores, un enlace cifrado entre ellos): se emparejan con
// un código, lo que cambia en uno aparece en el otro, el papel de principal se pasa, los adjuntos viajan y al
// desemparejar no queda nada puesto.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import type { Log } from "../log.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { installed } from "./journal.ts";
import { createSync, SYNC_PATH } from "./service.ts";

type T = { after: (f: () => void | Promise<void>) => void };
const quiet = { info() {}, warn() {}, error() {} } as unknown as Log;

async function machine(t: T, name: string) {
  const home = tempDir("colonia-sync-").path;
  const db = openDb(home);
  const store = new Map<string, string>();
  const secrets = {
    list: () => [...store.keys()].map((n) => ({ name: n })),
    resolve: (ref: string) => store.get(ref.replace("secret://", "")),
    set: (n: string, value: string | null) => void (value === null ? store.delete(n) : store.set(n, value)),
  };
  const server = http.createServer((_q, r) => r.writeHead(404).end());
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const seen = { touched: new Set<string>(), roles: 0, channels: [] as unknown[] };
  const sync = createSync({
    home,
    db,
    secrets,
    log: quiet,
    urls: () => [],
    local: () => url,
    name: () => name,
    tickMs: 30,
    changed: (s) => {
      for (const x of s) seen.touched.add(x);
    },
    roleChanged: () => void seen.roles++,
    channels: () => seen.channels,
  });
  server.on("upgrade", (req, socket, head) =>
    req.url === SYNC_PATH ? sync.upgrade(req, socket, head) : socket.destroy(),
  );
  sync.start();
  t.after(async () => {
    sync.stop();
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
    db.close();
    await removeDir(home);
  });
  return { home, db, store, secrets, sync, seen, url };
}

type M = Awaited<ReturnType<typeof machine>>;
const project = (m: M, id: string, name: string) =>
  m.db
    .prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, path.join(m.home, "proyectos", id), "2026-01-01T00:00:00Z");
const row = (m: M, id: string) =>
  m.db.prepare("SELECT name, path FROM projects WHERE id = ?").get(id) as { name: string; path: string } | undefined;
const until = (f: () => unknown, what: string) => waitFor(() => Boolean(f()), what, { ms: 15_000 });

async function paired(t: T) {
  const a = await machine(t, "Sobremesa");
  const b = await machine(t, "Portátil");
  const { code } = a.sync.pairStart();
  const got = await b.sync.pairJoin(code);
  assert.equal(got.name, "Sobremesa");
  await until(() => a.sync.status().connected && b.sync.status().connected, "los dos equipos no llegaron a conectarse");
  return { a, b };
}

test("sin emparejar no hay nada puesto", async (t) => {
  const a = await machine(t, "Solo");
  assert.equal(installed(a.db), false);
  assert.deepEqual(a.sync.status(), {
    paired: false,
    reachable: false,
    connected: false,
    mismatch: false,
    pending: 0,
    saved: 0,
  });
  assert.equal(a.sync.secondary(), false);
  assert.equal(fs.existsSync(path.join(a.home, "sincronizar.json")), false);
});

test("un código equivocado no empareja, y el bueno solo vale una vez", async (t) => {
  const a = await machine(t, "A");
  const b = await machine(t, "B");
  const c = await machine(t, "C");
  const { code } = a.sync.pairStart();
  const wrong = code.replace(/^\d{6}/, (d) => (d === "000000" ? "000001" : "000000"));
  await assert.rejects(b.sync.pairJoin(wrong), /código no es correcto/);
  assert.equal(b.sync.status().paired, false);
  await assert.rejects(b.sync.pairJoin("hola"), /no es válido/);
  await b.sync.pairJoin(code);
  await assert.rejects(c.sync.pairJoin(code), /ya está emparejado/);
  assert.equal(a.sync.status().peer?.name, "B");
});

test("emparejados: lo de cada uno aparece en el otro, con las rutas en su sitio", async (t) => {
  const a = await machine(t, "Sobremesa");
  const b = await machine(t, "Portátil");
  project(a, "antes-a", "Ya estaba en A");
  project(b, "antes-b", "Ya estaba en B");
  const { code } = a.sync.pairStart();
  await b.sync.pairJoin(code);
  assert.equal(a.sync.status().role, "principal");
  assert.equal(b.sync.status().role, "secundario");
  assert.equal(b.sync.secondary(), true);
  assert.equal(a.sync.secondary(), false);
  await until(() => row(b, "antes-a") && row(a, "antes-b"), "lo que ya había no se juntó");
  assert.equal(row(b, "antes-a")?.path, path.join(b.home, "proyectos", "antes-a"));
  project(a, "p1", "De A");
  project(b, "p2", "De B");
  a.secrets.set("openai", "clave-de-a");
  await until(() => row(b, "p1") && row(a, "p2") && b.store.get("openai"), "los cambios no cruzaron");
  assert.equal(b.store.get("openai"), "clave-de-a");
  assert.equal(b.store.has("sync.identidad") && b.store.get("sync.identidad") !== a.store.get("sync.identidad"), true);
  assert.ok(b.seen.touched.has("projects") && b.seen.touched.has("@clave"));
  await until(() => a.sync.status().pending + b.sync.status().pending === 0, "quedó algo por enviar");
  assert.ok(a.sync.status().last_sync_at && b.sync.status().last_sync_at);
});

test("un conflicto: gana el último, la otra versión se guarda y se recupera desde cualquiera", async (t) => {
  const { a, b } = await paired(t);
  project(a, "p1", "Original");
  await until(() => row(b, "p1"), "no llegó");
  // B se queda sin conexión (Colonia cerrada) y los dos cambian lo mismo; B, el último.
  b.sync.stop();
  a.db.prepare("UPDATE projects SET name = 'Versión de A' WHERE id = 'p1'").run();
  a.sync.tick();
  await new Promise((ok) => setTimeout(ok, 50));
  b.db.prepare("UPDATE projects SET name = 'Versión de B' WHERE id = 'p1'").run();
  // B vuelve: se reencuentran solos.
  const b2 = reopen(t, b);
  await until(() => row(a, "p1")?.name === "Versión de B", "no ganó el último cambio");
  assert.equal(row(b2, "p1")?.name, "Versión de B");
  await until(() => a.sync.status().saved === 1 && b2.sync.status().saved === 1, "la versión perdida no se guardó");
  const saved = b2.sync.saved().items[0];
  assert.equal(saved?.label, "Versión de A");
  assert.equal(saved?.kind, "project");
  assert.equal(saved?.mine, false);
  assert.equal(a.sync.saved().items[0]?.mine, true);
  assert.ok(b2.sync.recover(saved?.id ?? ""));
  await until(() => row(a, "p1")?.name === "Versión de A", "lo recuperado no llegó al otro equipo");
});

/** El mismo equipo tras reiniciar Colonia: misma carpeta, misma base, mismas claves. */
function reopen(t: T, m: M): M {
  const seen = { touched: new Set<string>(), roles: 0, channels: [] as unknown[] };
  const sync = createSync({
    home: m.home,
    db: m.db,
    secrets: m.secrets,
    log: quiet,
    urls: () => [],
    local: () => m.url,
    tickMs: 30,
    changed: (s) => {
      for (const x of s) seen.touched.add(x);
    },
    roleChanged: () => void seen.roles++,
    channels: () => seen.channels,
  });
  // El puerto lo tiene todavía el servidor anterior (se cierra al acabar la prueba): este equipo marca él.
  sync.start();
  t.after(() => sync.stop());
  return { ...m, sync, seen };
}

test("el principal lleva los canales; el otro ve su estado y puede pasar a llevarlos", async (t) => {
  const { a, b } = await paired(t);
  a.seen.channels = [{ id: "whatsapp", status: "connected", account: "+34 600" }];
  await until(() => b.sync.remoteChannels()?.length === 1, "el secundario no ve los canales del principal");
  assert.deepEqual(b.sync.remoteChannels(), a.seen.channels);
  const before = { a: a.seen.roles, b: b.seen.roles };
  b.sync.makePrincipal();
  await until(() => a.sync.secondary(), "el otro equipo no cedió los canales");
  assert.equal(b.sync.secondary(), false);
  assert.equal(b.sync.remoteChannels(), undefined);
  assert.ok(a.seen.roles > before.a && b.seen.roles > before.b);
  // Nunca hay dos principales ni ninguno.
  assert.deepEqual([a.sync.status().role, b.sync.status().role], ["secundario", "principal"]);
});

test("un adjunto llega con su fichero", async (t) => {
  const { a, b } = await paired(t);
  const file = path.join(a.home, "media", "foto.bin");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.alloc(1_300_000, 7);
  bytes.write("colonia");
  fs.writeFileSync(file, bytes);
  a.db
    .prepare("INSERT INTO media (id, kind, mime, bytes, path, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("m1", "image", "image/png", bytes.length, file, "2026-01-01T00:00:00Z");
  const there = path.join(b.home, "media", "foto.bin");
  await until(() => fs.existsSync(there), "el fichero no llegó");
  assert.ok(fs.readFileSync(there).equals(bytes));
  assert.equal(fs.existsSync(`${there}.sync-part`), false);
});

test("desemparejar en uno desempareja los dos y no deja nada", async (t) => {
  const { a, b } = await paired(t);
  b.db
    .prepare("INSERT INTO meta (key, value) VALUES ('setting:channels', ?)")
    .run(JSON.stringify([{ id: "tg", kind: "telegram", enabled: true }]));
  await until(() => a.db.prepare("SELECT 1 AS x FROM meta WHERE key = 'setting:channels'").get(), "no llegó el canal");
  a.sync.unpair();
  await until(() => !b.sync.status().paired, "el otro equipo siguió emparejado");
  for (const m of [a, b]) {
    assert.equal(installed(m.db), false);
    assert.equal(m.store.has("sync.identidad"), false);
    assert.equal(fs.existsSync(path.join(m.home, "sincronizar.json")), false);
    assert.equal(m.sync.secondary(), false);
  }
  const enabled = (m: M) =>
    (
      JSON.parse(
        (m.db.prepare("SELECT value FROM meta WHERE key = 'setting:channels'").get() as { value: string }).value,
      ) as { enabled: boolean }[]
    )[0]?.enabled;
  // El que llevaba los canales los conserva encendidos; el otro los deja apagados para no abrir la cuenta dos veces.
  assert.equal(enabled(a), true);
  assert.equal(enabled(b), false);
  // Y se puede volver a emparejar.
  await b.sync.pairJoin(a.sync.pairStart().code);
  await until(() => a.sync.status().connected, "no volvieron a conectarse");
});
