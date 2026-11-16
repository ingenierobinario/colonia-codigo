// D-192 fase 2 · El diario entre dos bases reales: lo que cambia en una llega a la otra, gana el último cambio y la
// versión que pierde queda guardada y se puede recuperar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_NAMES } from "@colonia/protocol";
import { openDb } from "../db/db.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { createJournal, discard, install, installed, type Journal, lostIn, TABLES, uninstall } from "./journal.ts";

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
  return {
    a,
    b,
    flow,
    settle,
    tick: (ms = 1000) => {
      now += ms;
    },
  };
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
    ...(cols.map((c) =>
      c in values
        ? values[c]
        : c.endsWith("_at")
          ? "2026-01-01T00:00:00Z"
          : c === "parts" || c === "agent_ids"
            ? "[]"
            : "x",
    ) as never[]),
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
    (
      db.prepare("SELECT id, seq FROM messages WHERE thread_id = 'h1' ORDER BY seq").all() as {
        id: string;
        seq: number;
      }[]
    )
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

test("los proyectos enlazados (D-191) viajan: de quién cuelga un proyecto, a cuáles conoce y qué lee un Flow", (t) => {
  const { a, b, settle, tick } = pair(t);
  project(a.db, "p-base", "Base");
  project(a.db, "p-hijo", "Hijo");
  insert(a.db, "flows", { id: "f-1", project_id: "p-hijo", name: "Flow" });
  settle();
  tick();
  a.db.prepare("UPDATE projects SET parent = ?, knows = ? WHERE id = ?").run("p-base", '["p-base"]', "p-hijo");
  a.db.prepare("UPDATE flows SET knowledge = ? WHERE id = ?").run('["p-base"]', "f-1");
  settle();
  assert.deepEqual(
    { ...(b.db.prepare("SELECT parent, knows FROM projects WHERE id = ?").get("p-hijo") as object) },
    { parent: "p-base", knows: '["p-base"]' },
  );
  assert.equal(
    (b.db.prepare("SELECT knowledge FROM flows WHERE id = ?").get("f-1") as { knowledge: string }).knowledge,
    '["p-base"]',
  );
});

/** Dos equipos que ya tenían cosas antes de emparejarse: manda A, que es quien generó el código. */
function joined(
  t: T,
  before: (da: Db, db: Db) => void,
  here?: { a: (p: string) => boolean; b: (p: string) => boolean },
) {
  let now = 1_800_000_000_000;
  const homes = [tempDir("colonia-sync-").path, tempDir("colonia-sync-").path];
  const [da, db] = homes.map((h) => openDb(h)) as [Db, Db];
  t.after(() => {
    da.close();
    db.close();
    for (const h of homes) void removeDir(h);
  });
  before(da, db);
  install(da);
  install(db);
  const ja = createJournal({ db: da, me: "aaa", now: () => now++, ...(here ? { folderHere: here.a } : {}) });
  const jb = createJournal({ db, me: "bbb", now: () => now++, ...(here ? { folderHere: here.b } : {}) });
  ja.baseline(false);
  jb.baseline(true);
  const settle = () => {
    for (let i = 0; i < 4; i++)
      for (const [from, to] of [
        [ja, jb],
        [jb, ja],
      ] as const) {
        from.seal();
        const items = from.pending(1000);
        to.apply(structuredClone(items));
        from.acked(items);
      }
    assert.equal(ja.pendingCount() + jb.pendingCount(), 0, "queda algo por enviar");
  };
  return { da, db, ja, jb, settle };
}

test("el nombre al azar del asistente no es un conflicto al emparejar; uno puesto a mano sí se guarda", (t) => {
  const agent = (db: Db, id: string, kind: string, name: string) => insert(db, "agents", { id, kind, name });
  const nameIn = (db: Db, id: string) =>
    (db.prepare("SELECT name FROM agents WHERE id = ?").get(id) as { name: string }).name;
  const [uno, otro] = [AGENT_NAMES[0] as string, AGENT_NAMES[1] as string];
  const azar = joined(t, (da, db) => {
    agent(da, "superagent", "secretary", uno);
    agent(db, "superagent", "secretary", `${otro} 2`);
  });
  azar.settle();
  assert.equal(nameIn(azar.da, "superagent"), uno);
  assert.equal(nameIn(azar.db, "superagent"), uno);
  assert.equal(azar.ja.lost().total + azar.jb.lost().total, 0);

  const mano = joined(t, (da, db) => {
    agent(da, "superagent", "secretary", uno);
    agent(db, "superagent", "secretary", "Mi mano derecha");
    agent(da, "ventas", "agent", uno);
    agent(db, "ventas", "agent", otro);
  });
  mano.settle();
  assert.equal(nameIn(mano.db, "superagent"), uno);
  // El nombre elegido por el dueño y el de un agente que no es el asistente sí quedan guardados.
  assert.equal(mano.jb.lost().total, 2);
});

test("el orden de las listas viaja", (t) => {
  const { a, b, settle, tick } = pair(t);
  const set = (db: Db, ids: string[]) =>
    db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('setting:navegadores', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(ids.map((id) => ({ id, browser: "chrome", name: id }))));
  const get = (db: Db) =>
    (
      JSON.parse(
        (db.prepare("SELECT value FROM meta WHERE key = 'setting:navegadores'").get() as { value: string }).value,
      ) as { id: string }[]
    ).map((e) => e.id);
  set(a.db, ["uno", "dos", "tres"]);
  settle();
  assert.deepEqual(get(b.db), ["uno", "dos", "tres"]);
  tick();
  set(b.db, ["tres", "uno", "dos"]);
  settle();
  assert.deepEqual(get(a.db), ["tres", "uno", "dos"]);
  // Cada uno añade uno a la vez: los dos acaban con los mismos y en el mismo orden.
  tick();
  set(a.db, ["tres", "uno", "dos", "de-a"]);
  tick();
  set(b.db, ["de-b", "tres", "uno", "dos"]);
  settle();
  assert.deepEqual(get(a.db), get(b.db));
  assert.deepEqual([...get(a.db)].sort(), ["de-a", "de-b", "dos", "tres", "uno"]);
  assert.equal(a.journal.lost().total + b.journal.lost().total, 0);
});

test("la carpeta de un proyecto solo viaja si existe en el otro equipo", (t) => {
  const row = (db: Db, id: string) =>
    db.prepare("SELECT name, path, present FROM projects WHERE id = ?").get(id) as {
      name: string;
      path: string;
      present: number;
    };
  const put = (db: Db, id: string, p: string) =>
    db
      .prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')")
      .run(id, id, p);
  const { da, db, settle } = joined(t, () => {}, {
    a: (p) => p.startsWith("/a/") || p.startsWith("/comun/"),
    b: (p) => p.startsWith("/b/") || p.startsWith("/comun/"),
  });
  put(da, "igual", "/comun/igual");
  put(da, "solo-a", "/a/solo-a");
  settle();
  // La que existe en los dos llega como ruta; la otra queda apuntada como «falta aquí».
  assert.deepEqual({ ...row(db, "igual") }, { name: "igual", path: "/comun/igual", present: 1 });
  assert.deepEqual({ ...row(db, "solo-a") }, { name: "solo-a", path: "/a/solo-a", present: 0 });
  assert.equal(row(da, "solo-a").present, 1);
  // B elige la suya: A conserva la que tenía, y los cambios de nombre siguen cruzando sin pisar carpetas.
  db.prepare("UPDATE projects SET path = '/b/elegida', present = 1 WHERE id = 'solo-a'").run();
  settle();
  assert.equal(row(da, "solo-a").path, "/a/solo-a");
  da.prepare("UPDATE projects SET name = 'Renombrado' WHERE id = 'solo-a'").run();
  settle();
  assert.deepEqual({ ...row(db, "solo-a") }, { name: "Renombrado", path: "/b/elegida", present: 1 });
  assert.deepEqual({ ...row(da, "solo-a") }, { name: "Renombrado", path: "/a/solo-a", present: 1 });
  assert.equal(lostIn(da).total + lostIn(db).total, 0);
});

test("al quitar la sincronización las versiones guardadas siguen ahí hasta que se borran", (t) => {
  const { a, b, settle, tick } = pair(t);
  project(a.db, "p1", "Original");
  a.secrets.set("openai", "clave-uno");
  settle();
  a.db.prepare("UPDATE projects SET name = 'Versión de A' WHERE id = 'p1'").run();
  a.secrets.set("openai", "clave-de-a");
  a.journal.seal();
  a.journal.scanSecrets();
  tick();
  b.db.prepare("UPDATE projects SET name = 'Versión de B' WHERE id = 'p1'").run();
  b.secrets.set("openai", "clave-de-b");
  settle();
  assert.equal(a.journal.lost().total, 2);
  const kept = [...a.store.keys()].filter((k) => k.startsWith("sync.perdida."));
  assert.equal(kept.length, 1);
  uninstall(a.db, a.secrets);
  assert.equal(installed(a.db), false);
  assert.equal(lostIn(a.db).total, 2);
  assert.ok(a.store.has(kept[0] as string), "la clave guardada se perdió al quitar la sincronización");
  // Borrar una, y luego todas: no queda ni la tabla ni la clave.
  const one = lostIn(a.db).items.find((i) => i.tbl === "projects")?.id;
  assert.equal(discard(a.db, a.secrets, one), 1);
  assert.equal(lostIn(a.db).total, 1);
  assert.equal(discard(a.db, a.secrets), 1);
  assert.equal(a.store.has(kept[0] as string), false);
  assert.deepEqual(a.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sync!_%' ESCAPE '!'").all(), []);
  // Con pareja, el borrado se hace igual desde el diario.
  assert.equal(b.journal.discard(), 2);
  assert.equal(b.journal.lost().total, 0);
});
