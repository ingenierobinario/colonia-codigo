// D-192 fase 2 · El diario entre dos bases reales: lo que cambia en una llega a la otra, gana el último cambio y la
// versión que pierde queda guardada y se puede recuperar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { createJournal, install, installed, type Journal, TABLES, uninstall } from "./journal.ts";

type Db = ReturnType<typeof openDb>;
type T = { after: (f: () => void) => void };

function pair(t: T) {
  let now = 1_800_000_000_000;
  const make = (me: string) => {
    const home = tempDir("colonia-sync-").path;
    const db = openDb(home);
    t.after(() => {
      db.close();
      void removeDir(home);
    });
    const store = new Map<string, string>();
    const secrets = {
      list: () => [...store.keys()].map((name) => ({ name })),
      resolve: (ref: string) => store.get(ref.replace("secret://", "")),
      set: (name: string, value: string | null) => void (value === null ? store.delete(name) : store.set(name, value)),
    };
    install(db);
    const journal = createJournal({ db, me, now: () => now, secrets });
    return { db, journal, secrets, store };
  };
  const a = make("aaa");
  const b = make("bbb");
  a.journal.baseline(false);
  b.journal.baseline(true);
  const flow = (from: Journal, to: Journal) => {
    from.seal();
    from.scanSecrets();
    let kept = 0;
    for (;;) {
      const items = from.pending(100);
      if (!items.length) break;
      const r = to.apply(structuredClone(items));
      assert.equal(r.failed, 0);
      kept += r.kept;
      from.acked(items);
    }
    return kept;
  };
  const settle = () => {
    let kept = 0;
    for (let i = 0; i < 4; i++) kept += flow(a.journal, b.journal) + flow(b.journal, a.journal);
    assert.equal(a.journal.pendingCount() + b.journal.pendingCount(), 0, "queda algo por enviar");
    return kept;
  };
  return { a, b, flow, settle, tick: (ms = 1000) => void (now += ms) };
}

const project = (db: Db, id: string, name: string) =>
  db
    .prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, `/tmp/${id}`, "2026-01-01T00:00:00Z");
const nameOf = (db: Db, id: string) =>
  (db.prepare("SELECT name FROM projects WHERE id = ?").get(id) as { name: string } | undefined)?.name;

/** Inserta una fila rellenando lo obligatorio con valores de relleno. */
function insert(db: Db, table: string, values: Record<string, unknown>) {
  const cols = (
    db.prepare(`SELECT name, "notnull" AS nn, dflt_value AS d FROM pragma_table_info('${table}')`).all() as {
      name: string;
      nn: number;
      d: unknown;
    }[]
  )
    .filter((c) => c.name in values || (c.nn && c.d === null))
    .map((c) => c.name);
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...(cols.map((c) => (c in values ? values[c] : c.endsWith("_at") ? "2026-01-01T00:00:00Z" : c === "parts" || c === "agent_ids" ? "[]" : "x")) as never[]),
  );
}

test("todas las tablas que viajan existen y tienen clave", (t) => {
  const home = tempDir("colonia-sync-").path;
  const db = openDb(home);
  t.after(() => {
    db.close();
    removeDir(home);
  });
  install(db);
  const triggers = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_t_%'").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  for (const tbl of TABLES) assert.ok(triggers.has(`sync_t_${tbl}_i`), `falta ${tbl}`);
  assert.ok(installed(db));
  uninstall(db);
  assert.equal(installed(db), false);
  const left = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sync!_%' ESCAPE '!'").all();
  assert.deepEqual(left, []);
});

test("un cambio en un equipo aparece en el otro, en los dos sentidos", (t) => {
  const { a, b, settle } = pair(t);
  settle();
  project(a.db, "p1", "De A");
  project(b.db, "p2", "De B");
  settle();
  assert.equal(nameOf(b.db, "p1"), "De A");
  assert.equal(nameOf(a.db, "p2"), "De B");
  a.db.prepare("UPDATE projects SET name = 'Cambiado' WHERE id = 'p2'").run();
  settle();
  assert.equal(nameOf(b.db, "p2"), "Cambiado");
  b.db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
  settle();
  assert.equal(nameOf(a.db, "p1"), undefined);
});

test("si los dos cambian lo mismo gana el último y la otra versión se guarda y se recupera", (t) => {
  const { a, b, settle, tick } = pair(t);
  project(a.db, "p1", "Original");
  settle();
  a.db.prepare("UPDATE projects SET name = 'Versión de A' WHERE id = 'p1'").run();
  a.journal.seal();
  tick();
  b.db.prepare("UPDATE projects SET name = 'Versión de B' WHERE id = 'p1'").run();
  b.journal.seal();
  assert.ok(settle() >= 1);
  assert.equal(nameOf(a.db, "p1"), "Versión de B");
  assert.equal(nameOf(b.db, "p1"), "Versión de B");
  for (const side of [a, b]) {
    const lost = side.journal.lost();
    assert.equal(lost.total, 1);
    assert.equal((JSON.parse(lost.items[0]?.row ?? "{}") as { name: string }).name, "Versión de A");
  }
  tick();
  assert.ok(b.journal.recover(b.journal.lost().items[0]?.id ?? ""));
  settle();
  assert.equal(nameOf(a.db, "p1"), "Versión de A");
  assert.equal(nameOf(b.db, "p1"), "Versión de A");
  // Lo que había al recuperar tampoco se pierde.
  assert.equal(a.journal.lost().total, 2);
  assert.ok(a.journal.lost().items.some((i) => i.recovered_at));
});

test("el mismo contenido en los dos no es un conflicto", (t) => {
  const { a, b, settle, tick } = pair(t);
  project(a.db, "p1", "Igual");
  settle();
  a.db.prepare("UPDATE projects SET name = 'Lo mismo' WHERE id = 'p1'").run();
  tick();
  b.db.prepare("UPDATE projects SET name = 'Lo mismo' WHERE id = 'p1'").run();
  assert.equal(settle(), 0);
  assert.equal(a.journal.lost().total, 0);
});

test("las listas de ajustes se mezclan elemento a elemento", (t) => {
  const { a, b, settle, tick } = pair(t);
  const set = (db: Db, list: unknown[]) =>
    db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('setting:navegadores', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(list));
  const get = (db: Db) =>
    (
      JSON.parse(
        (db.prepare("SELECT value FROM meta WHERE key = 'setting:navegadores'").get() as { value: string }).value,
      ) as { id: string; name: string }[]
    )
      .map((e) => `${e.id}=${e.name}`)
      .sort();
  set(a.db, [{ id: "trabajo", browser: "chrome", name: "Trabajo" }]);
  set(b.db, [{ id: "personal", browser: "edge", name: "Personal" }]);
  settle();
  assert.deepEqual(get(a.db), ["personal=Personal", "trabajo=Trabajo"]);
  assert.deepEqual(get(b.db), get(a.db));
  tick();
  set(b.db, [{ id: "personal", browser: "edge", name: "Casa" }]);
  settle();
  assert.deepEqual(get(a.db), ["personal=Casa"]);
  // Un ajuste de este equipo no viaja.
  a.db.prepare("INSERT INTO meta (key, value) VALUES ('setting:desktop', '{}')").run();
  a.db.prepare("INSERT INTO meta (key, value) VALUES ('setting:owner_language', 'es')").run();
  settle();
  assert.equal(b.db.prepare("SELECT 1 AS x FROM meta WHERE key = 'setting:desktop'").get(), undefined);
  assert.ok(b.db.prepare("SELECT 1 AS x FROM meta WHERE key = 'setting:owner_language'").get());
});

test("las claves viajan, y la que pierde se guarda fuera de la base", (t) => {
  const { a, b, settle, tick } = pair(t);
  a.secrets.set("openai", "clave-uno");
  a.secrets.set("sync.identidad", "no-viaja");
  settle();
  assert.equal(b.store.get("openai"), "clave-uno");
  assert.equal(b.store.has("sync.identidad"), false);
  a.secrets.set("openai", "clave-de-a");
  a.journal.scanSecrets();
  tick();
  b.secrets.set("openai", "clave-de-b");
  b.journal.scanSecrets();
  settle();
  assert.equal(a.store.get("openai"), "clave-de-b");
  const lost = a.journal.lost().items[0];
  assert.ok(lost && !lost.row.includes("clave-de-a"));
  tick();
  assert.ok(a.journal.recover(lost.id));
  settle();
  assert.equal(b.store.get("openai"), "clave-de-a");
  a.secrets.set("openai", null);
  settle();
  assert.equal(b.store.has("openai"), false);
});

test("dos mensajes escritos a la vez en el mismo chat se conservan los dos", (t) => {
  const { a, b, settle, tick } = pair(t);
  insert(a.db, "threads", { id: "h1" });
  settle();
  assert.ok(b.db.prepare("SELECT 1 AS x FROM threads WHERE id = 'h1'").get());
  const say = (db: Db, id: string, at: string) =>
    insert(db, "messages", { id, thread_id: "h1", seq: 1, created_at: at, role: "user" });
  say(a.db, "ma", "2026-01-01T00:00:01Z");
  tick();
  say(b.db, "mb", "2026-01-01T00:00:02Z");
  settle();
  const seqs = (db: Db) =>
    (db.prepare("SELECT id, seq FROM messages WHERE thread_id = 'h1' ORDER BY seq").all() as { id: string; seq: number }[])
      .map((m) => `${m.id}:${m.seq}`)
      .join(" ");
  assert.equal(seqs(a.db), "ma:1 mb:2");
  assert.equal(seqs(b.db), "ma:1 mb:2");
  assert.equal(a.journal.lost().total, 0);
});

test("al emparejar, lo que ya había se junta y manda el equipo que generó el código", (t) => {
  let now = 1_800_000_000_000;
  const homes = [tempDir("colonia-sync-").path, tempDir("colonia-sync-").path];
  const [da, db] = homes.map((h) => openDb(h)) as [Db, Db];
  t.after(() => {
    da.close();
    db.close();
    for (const h of homes) void removeDir(h);
  });
  project(da, "comun", "El de A");
  project(db, "comun", "El de B");
  project(db, "solo-b", "Solo en B");
  install(da);
  install(db);
  const ja = createJournal({ db: da, me: "aaa", now: () => now++ });
  const jb = createJournal({ db, me: "bbb", now: () => now++ });
  ja.baseline(false);
  jb.baseline(true);
  for (let i = 0; i < 3; i++) {
    for (const [from, to] of [
      [ja, jb],
      [jb, ja],
    ] as const) {
      const items = from.pending(1000);
      to.apply(structuredClone(items));
      from.acked(items);
    }
  }
  assert.equal(nameOf(da, "comun"), "El de A");
  assert.equal(nameOf(db, "comun"), "El de A");
  assert.equal(nameOf(da, "solo-b"), "Solo en B");
  assert.equal(jb.lost().total, 1);
  assert.equal(ja.lost().total, 1);
});
