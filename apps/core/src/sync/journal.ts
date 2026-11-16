// D-192 fase 2 · El diario de cambios de la sincronización entre dos equipos del mismo dueño.
// Cada fila que cambia se apunta sola (disparadores), se sella con un reloj lógico y viaja al otro equipo. Si los dos
// tocaron lo mismo, gana el último cambio y la versión que pierde queda guardada en `sync_perdidas`, recuperable.
// Nada de esto existe en la base hasta que se empareja: `install` lo crea y `uninstall` lo borra entero.
import { createHash, createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Las tablas que viajan, en orden de dependencia (las que otras referencian, primero). */
export const TABLES = [
  "projects",
  "agents",
  "persons",
  "addresses",
  "threads",
  "messages",
  "model_log",
  "memories",
  "memory_exclusions",
  "routines",
  "flows",
  "flow_graph_drafts",
  "flow_graph_revisions",
  "flow_graph_history",
  "flow_table_defs",
  "flow_tables",
  "flow_rows",
  "flow_schedules",
  "retired_flows",
  "surfaces",
  "stickers",
  "tasks",
  "task_attachments",
  "media",
  "outbox",
  "sync_perdidas",
] as const;

/** Tablas cuya clave de fila no es su clave primaria (un contador local que no puede viajar). */
const LOGICAL_KEY: Readonly<Record<string, { key: string[]; omit: string[] }>> = {
  memories: { key: ["id"], omit: ["n"] },
};

/** Ajustes que son una lista de elementos con `id`: se sincronizan elemento a elemento, no la lista entera. */
export const LISTS = new Set([
  "channels",
  "webapps",
  "navegadores",
  "providers",
  "acp_agents",
  "services",
  "email_signatures",
  "mcp_servers",
]);

/** Ajustes que hablan de ESTE equipo y no viajan. */
const LOCAL_SETTINGS = [
  "desktop",
  "computer",
  "vm_",
  "telemetry",
  "release_seen",
  "secrets_file_told",
  "setup_done",
  "task_work_since",
  "tool_once_grants",
  "tool_session_grants",
  "memory_capture_cleanup",
  "memory_dream_snapshot",
  "memory_generation",
  "public-route-credentials",
  "copia_restaurada",
  "services_offered",
  "local_alias",
];
export const settingTravels = (name: string) => !LOCAL_SETTINGS.some((p) => name.startsWith(p));

const LIST = "@lista:";
export const SECRET = "@clave";
const LOST_SECRET = "sync.perdida.";
/** Los secretos propios de la sincronización nunca viajan. */
export const ownSecret = (name: string) => name.startsWith("sync.") && !name.startsWith(LOST_SECRET);

const PATH_COLUMNS: Readonly<Record<string, string[]>> = { projects: ["path"], threads: ["cwd"], media: ["path"] };
const JSON_PATH_COLUMNS: Readonly<Record<string, string[]>> = {
  projects: ["read_only_folders"],
  meta: ["value"],
  sync_perdidas: ["row"],
};

export type Row = Record<string, unknown>;
export type Item = { tbl: string; pk: string; hlc: string; origin: string; del: boolean; row?: Row };
export type Applied = { applied: number; kept: number; failed: number; touched: Set<string>; waiting: Item[] };
export type Lost = {
  id: string;
  tbl: string;
  pk: string;
  origin: string;
  row: string;
  lost_at: string;
  recovered_at: string | null;
};

export type SecretsPort = {
  list(): { name: string }[];
  resolve(ref: string): string | undefined;
  set(name: string, value: string | null): void;
};

export type JournalDeps = {
  db: DatabaseSync;
  /** El identificador de este equipo: desempata dos cambios con el mismo sello. */
  me: string;
  now?: () => number;
  secrets?: SecretsPort;
  /** Qué secretos viajan (los de este equipo, no). */
  secretTravels?: (name: string) => boolean;
  /** Sal para no dejar en la base una huella reconocible de cada secreto. */
  salt?: string;
  warn?: (msg: string) => void;
};

const deep = (v: unknown, f: (s: string) => string): unknown =>
  typeof v === "string"
    ? f(v)
    : Array.isArray(v)
      ? v.map((x) => deep(x, f))
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)]))
        : v;

const encode = (v: unknown): unknown =>
  v instanceof Uint8Array ? { $b: Buffer.from(v).toString("base64") } : typeof v === "bigint" ? Number(v) : v;
const decode = (v: unknown): unknown =>
  v && typeof v === "object" && typeof (v as { $b?: unknown }).$b === "string"
    ? Buffer.from((v as { $b: string }).$b, "base64")
    : typeof v === "boolean"
      ? Number(v)
      : v && typeof v === "object"
        ? JSON.stringify(v)
        : (v ?? null);

const stable = (row: Row) =>
  JSON.stringify(
    Object.keys(row)
      .sort()
      .map((k) => [k, row[k]]),
  );
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const trig = (tbl: string, op: string) => `sync_t_${tbl}_${op}`;

export const installed = (db: DatabaseSync) =>
  !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'sync_ver'").get();

type Shape = { cols: string[]; key: string[]; omit: Set<string> };

function shapeOf(db: DatabaseSync, tbl: string): Shape | undefined {
  const info = db.prepare(`SELECT name, pk FROM pragma_table_info('${tbl}')`).all() as { name: string; pk: number }[];
  if (!info.length) return undefined;
  const logical = LOGICAL_KEY[tbl];
  const key =
    logical?.key ??
    info
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
  if (!key.length) return undefined;
  return { cols: info.map((c) => c.name), key, omit: new Set(logical?.omit ?? []) };
}

/** Crea las tablas del diario y los disparadores que apuntan cada cambio. Se puede repetir. */
export function install(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_dirty (n INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_ver (
      tbl TEXT NOT NULL, pk TEXT NOT NULL, hlc TEXT NOT NULL, origin TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, hash TEXT NOT NULL DEFAULT '', synced INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tbl, pk)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS sync_ver_pending ON sync_ver (synced, hlc);
    CREATE TABLE IF NOT EXISTS sync_perdidas (
      id TEXT PRIMARY KEY, tbl TEXT NOT NULL, pk TEXT NOT NULL, hlc TEXT NOT NULL, origin TEXT NOT NULL,
      row TEXT NOT NULL, lost_at TEXT NOT NULL, recovered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_flag (id INTEGER PRIMARY KEY CHECK (id = 1), applying INTEGER NOT NULL);
    INSERT OR IGNORE INTO sync_flag (id, applying) VALUES (1, 0);
    UPDATE sync_flag SET applying = 0;
  `);
  const quiet = "(SELECT applying FROM sync_flag) = 0";
  for (const tbl of TABLES) {
    const shape = shapeOf(db, tbl);
    if (!shape) continue;
    const pk = (ref: string) => `json_array(${shape.key.map((c) => `${ref}.${q(c)}`).join(", ")})`;
    const note = (ref: string) => `INSERT INTO sync_dirty (tbl, pk) VALUES ('${tbl}', ${pk(ref)});`;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${trig(tbl, "i")} AFTER INSERT ON ${q(tbl)} WHEN ${quiet} BEGIN ${note("NEW")} END;
      CREATE TRIGGER IF NOT EXISTS ${trig(tbl, "u")} AFTER UPDATE ON ${q(tbl)} WHEN ${quiet} BEGIN ${note("NEW")} ${note("OLD")} END;
      CREATE TRIGGER IF NOT EXISTS ${trig(tbl, "d")} AFTER DELETE ON ${q(tbl)} WHEN ${quiet} BEGIN ${note("OLD")} END;
    `);
  }
  const meta = (ref: string, op: string, when: string) => `
    CREATE TRIGGER IF NOT EXISTS ${trig("meta", op)} AFTER ${when} ON meta
    WHEN ${quiet} AND ${ref}.key LIKE 'setting:%'
    BEGIN INSERT INTO sync_dirty (tbl, pk) VALUES ('meta', json_array(${ref}.key)); END;`;
  db.exec(meta("NEW", "i", "INSERT") + meta("NEW", "u", "UPDATE") + meta("OLD", "d", "DELETE"));
}

/** Quita todo rastro de la sincronización: la base queda como la de un Colonia que nunca se emparejó. */
export function uninstall(db: DatabaseSync, secrets?: SecretsPort): void {
  const names = db
    .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'sync!_%' ESCAPE '!' AND type IN ('trigger', 'table')")
    .all() as { name: string; type: string }[];
  for (const t of names.filter((n) => n.type === "trigger")) db.exec(`DROP TRIGGER IF EXISTS ${q(t.name)}`);
  for (const t of names.filter((n) => n.type === "table")) db.exec(`DROP TABLE IF EXISTS ${q(t.name)}`);
  for (const s of secrets?.list() ?? []) if (s.name.startsWith(LOST_SECRET)) secrets?.set(s.name, null);
}

export function createJournal(d: JournalDeps) {
  const { db, me } = d;
  const clock = d.now ?? Date.now;
  const warn = d.warn ?? (() => {});
  const shapes = new Map<string, Shape | undefined>();
  const shape = (tbl: string) => {
    if (!shapes.has(tbl)) shapes.set(tbl, (TABLES as readonly string[]).includes(tbl) ? shapeOf(db, tbl) : undefined);
    return shapes.get(tbl);
  };
  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as T | undefined;
  const all = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[];
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...(args as never[]));

  // ── Reloj lógico: milisegundos + contador. Siempre crece, también si el otro equipo va adelantado. ──
  let lastMs = 0;
  let counter = 0;
  let low = false;
  const stampOf = (ms: number, n: number) => String(ms).padStart(13, "0") + String(n).padStart(8, "0");
  const observe = (hlc: string) => {
    const ms = Number(hlc.slice(0, 13));
    const n = Number(hlc.slice(13));
    if (ms > lastMs || (ms === lastMs && n > counter)) {
      lastMs = ms;
      counter = n;
    }
  };
  const top = one<{ h: string | null }>("SELECT max(hlc) AS h FROM sync_ver")?.h;
  if (top) observe(top);
  const tick = () => {
    if (low) return stampOf(1, ++counter);
    const ms = clock();
    if (ms > lastMs) {
      lastMs = ms;
      counter = 0;
    } else counter++;
    return stampOf(lastMs, counter);
  };
  const newer = (aH: string, aO: string, bH: string, bO: string) => (aH === bH ? aO > bO : aH > bH);

  // ── Leer y escribir una fila por su clave ──
  const where = (s: Shape) => s.key.map((c) => `${q(c)} IS ?`).join(" AND ");
  const keyOf = (pk: string): unknown[] => JSON.parse(pk) as unknown[];
  const pkOf = (s: Shape, row: Row) => JSON.stringify(s.key.map((c) => row[c]));

  function readRow(tbl: string, pk: string): Row | undefined {
    if (tbl.startsWith(LIST)) return listOf(tbl.slice(LIST.length)).find((e) => e.id === pk);
    if (tbl === SECRET) {
      const value = d.secrets?.resolve(`secret://${pk}`);
      return value === undefined ? undefined : { value };
    }
    if (tbl === "meta") {
      const r = one<Row>("SELECT key, value FROM meta WHERE key = ?", keyOf(pk)[0]);
      return r && { ...r };
    }
    const s = shape(tbl);
    if (!s) return undefined;
    const r = one<Row>(`SELECT * FROM ${q(tbl)} WHERE ${where(s)}`, ...keyOf(pk));
    if (!r) return undefined;
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) if (!s.omit.has(k)) out[k] = encode(v);
    return out;
  }

  const hashOf = (tbl: string, row: Row) =>
    tbl === SECRET
      ? createHmac("sha256", d.salt ?? me)
          .update(String(row.value))
          .digest("hex")
          .slice(0, 32)
      : sha(stable(row));

  function listOf(name: string): (Row & { id: string })[] {
    const raw = one<{ value: string }>("SELECT value FROM meta WHERE key = ?", `setting:${name}`)?.value;
    if (!raw) return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v)
        ? (v.filter((e) => e && typeof e === "object" && typeof (e as Row).id === "string") as (Row & { id: string })[])
        : [];
    } catch {
      return [];
    }
  }
  const saveList = (name: string, list: Row[]) =>
    run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      `setting:${name}`,
      JSON.stringify(list),
    );

  function writeRow(tbl: string, pk: string, row: Row | undefined): void {
    if (tbl.startsWith(LIST)) {
      const name = tbl.slice(LIST.length);
      const list = listOf(name);
      const at = list.findIndex((e) => e.id === pk);
      if (!row) {
        if (at >= 0) list.splice(at, 1);
      } else if (at >= 0) list[at] = row as Row & { id: string };
      else list.push(row as Row & { id: string });
      return void saveList(name, list);
    }
    if (tbl === SECRET) return void d.secrets?.set(pk, row ? String(row.value) : null);
    if (tbl === "meta") {
      const key = keyOf(pk)[0];
      if (!row) return void run("DELETE FROM meta WHERE key = ?", key);
      return void run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        decode(row.value),
      );
    }
    const s = shape(tbl);
    if (!s) throw new Error(`tabla desconocida: ${tbl}`);
    const key = keyOf(pk);
    if (!row) return void run(`DELETE FROM ${q(tbl)} WHERE ${where(s)}`, ...key);
    const cols = s.cols.filter((c) => c in row && !s.omit.has(c));
    const values = cols.map((c) => decode(row[c]));
    if (one(`SELECT 1 AS x FROM ${q(tbl)} WHERE ${where(s)}`, ...key))
      run(`UPDATE ${q(tbl)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${where(s)}`, ...values, ...key);
    else
      run(`INSERT INTO ${q(tbl)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...values);
  }

  // ── Sellar: cada cambio apuntado recibe un sello nuevo si de verdad cambió el contenido ──
  type Ver = { hlc: string; origin: string; deleted: number; hash: string; synced: number };
  const verOf = (tbl: string, pk: string) =>
    one<Ver>("SELECT hlc, origin, deleted, hash, synced FROM sync_ver WHERE tbl = ? AND pk = ?", tbl, pk);
  const setVer = (tbl: string, pk: string, v: Ver) =>
    run(
      `INSERT INTO sync_ver (tbl, pk, hlc, origin, deleted, hash, synced) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tbl, pk) DO UPDATE SET hlc = excluded.hlc, origin = excluded.origin, deleted = excluded.deleted,
         hash = excluded.hash, synced = excluded.synced`,
      tbl,
      pk,
      v.hlc,
      v.origin,
      v.deleted,
      v.hash,
      v.synced,
    );

  /** Anota el estado actual de una fila como cambio de este equipo. Devuelve si había algo nuevo. */
  function stamp(tbl: string, pk: string, row = readRow(tbl, pk)): boolean {
    const ver = verOf(tbl, pk);
    const hash = row ? hashOf(tbl, row) : "";
    const deleted = row ? 0 : 1;
    if (!ver && deleted) return false;
    if (ver && ver.deleted === deleted && ver.hash === hash) return false;
    setVer(tbl, pk, { hlc: tick(), origin: me, deleted, hash, synced: 0 });
    return true;
  }

  function stampList(name: string): void {
    const tbl = LIST + name;
    const list = listOf(name);
    const seen = new Set<string>();
    for (const e of list) {
      seen.add(e.id);
      stamp(tbl, e.id, e);
    }
    for (const v of all<{ pk: string }>("SELECT pk FROM sync_ver WHERE tbl = ? AND deleted = 0", tbl))
      if (!seen.has(v.pk)) stamp(tbl, v.pk, undefined);
  }

  function stampSetting(key: string): void {
    const name = key.slice("setting:".length);
    if (!settingTravels(name)) return;
    if (LISTS.has(name)) return stampList(name);
    stamp("meta", JSON.stringify([key]));
  }

  const travels = (name: string) => !ownSecret(name) && (d.secretTravels?.(name) ?? true);
  /** Los secretos no tienen disparadores: se comparan con lo último visto. */
  function scanSecrets(): void {
    if (!d.secrets) return;
    const seen = new Set<string>();
    for (const s of d.secrets.list()) {
      if (!travels(s.name)) continue;
      const value = d.secrets.resolve(`secret://${s.name}`);
      if (value === undefined) continue;
      seen.add(s.name);
      stamp(SECRET, s.name, { value });
    }
    for (const v of all<{ pk: string }>("SELECT pk FROM sync_ver WHERE tbl = ? AND deleted = 0", SECRET))
      if (!seen.has(v.pk)) stamp(SECRET, v.pk, undefined);
  }

  function seal(): void {
    const max = one<{ n: number | null }>("SELECT max(n) AS n FROM sync_dirty")?.n;
    if (!max) return;
    for (const c of all<{ tbl: string; pk: string }>("SELECT DISTINCT tbl, pk FROM sync_dirty WHERE n <= ?", max)) {
      if (c.tbl === "meta") stampSetting(String(keyOf(c.pk)[0]));
      else stamp(c.tbl, c.pk);
    }
    run("DELETE FROM sync_dirty WHERE n <= ?", max);
  }

  const tx = <T>(f: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = f();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const silently = <T>(f: () => T): T => {
    run("UPDATE sync_flag SET applying = 1");
    try {
      return f();
    } finally {
      run("UPDATE sync_flag SET applying = 0");
    }
  };

  // ── Guardar la versión que pierde ──
  function keep(tbl: string, pk: string, hlc: string, origin: string, row: Row, winner: string): boolean {
    if (tbl === "sync_perdidas") return false;
    const id = sha(`${tbl}\n${pk}\n${hlc}\n${origin}`);
    if (one("SELECT 1 AS x FROM sync_perdidas WHERE id = ?", id)) return false;
    let saved = row;
    if (tbl === SECRET) {
      d.secrets?.set(LOST_SECRET + id, String(row.value));
      saved = { $secreto: 1 };
    }
    const lostAt = new Date(Number(winner.slice(0, 13)) || clock()).toISOString();
    run(
      "INSERT INTO sync_perdidas (id, tbl, pk, hlc, origin, row, lost_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      tbl,
      pk,
      hlc,
      origin,
      JSON.stringify(saved),
      lostAt,
    );
    stamp("sync_perdidas", JSON.stringify([id]));
    return true;
  }

  // ── Rutas: lo que llega habla de carpetas del otro equipo ──
  let move: ((path: string) => string) | undefined;
  function localize(tbl: string, row: Row): Row {
    if (!move) return row;
    const f = move;
    if (tbl.startsWith(LIST)) return deep(row, f) as Row;
    const out = { ...row };
    for (const c of PATH_COLUMNS[tbl] ?? []) if (typeof out[c] === "string") out[c] = f(out[c] as string);
    for (const c of JSON_PATH_COLUMNS[tbl] ?? []) {
      if (typeof out[c] !== "string") continue;
      try {
        out[c] = JSON.stringify(deep(JSON.parse(out[c] as string), f));
      } catch {}
    }
    return out;
  }

  /** Dos filas distintas que no caben a la vez (misma ruta de flujo, mismo número de mensaje…). */
  function clash(tbl: string, pk: string, item: Item, row: Row): "retry" | "skip" {
    const s = shape(tbl);
    if (!s) return "skip";
    const indexes = all<{ name: string; unique: number; origin: string }>(`SELECT * FROM pragma_index_list('${tbl}')`);
    for (const ix of indexes.filter((i) => i.unique && (i.origin !== "pk" || tbl in LOGICAL_KEY))) {
      const cols = all<{ name: string | null }>(`SELECT name FROM pragma_index_info('${ix.name}')`).map((c) => c.name);
      if (cols.some((c) => !c || row[c] === null || row[c] === undefined)) continue;
      if (cols.join() === s.key.join()) continue;
      const other = one<Row>(
        `SELECT * FROM ${q(tbl)} WHERE ${cols.map((c) => `${q(c as string)} = ?`).join(" AND ")}`,
        ...cols.map((c) => decode(row[c as string])),
      );
      if (!other) continue;
      const otherPk = pkOf(s, other);
      if (otherPk === pk) continue;
      if (tbl === "messages" && cols.join() === "thread_id,seq") {
        // Los dos equipos escribieron en el mismo chat a la vez: nadie pierde su mensaje, el más reciente se recoloca.
        const next =
          (one<{ m: number | null }>("SELECT max(seq) AS m FROM messages WHERE thread_id = ?", row.thread_id)?.m ?? 0) +
          1;
        const later = (a: Row, b: Row) =>
          String(a.created_at) === String(b.created_at)
            ? String(a.id) > String(b.id)
            : String(a.created_at) > String(b.created_at);
        if (later(row, other)) {
          row.seq = next;
          item.origin = "";
        } else {
          run("UPDATE messages SET seq = ? WHERE id = ?", next, other.id);
          stamp(tbl, otherPk);
        }
        return "retry";
      }
      const ov = verOf(tbl, otherPk);
      const otherRow = readRow(tbl, otherPk);
      if (!ov || newer(item.hlc, item.origin, ov.hlc, ov.origin)) {
        if (otherRow) keep(tbl, otherPk, ov?.hlc ?? stampOf(0, 0), ov?.origin ?? me, otherRow, item.hlc);
        writeRow(tbl, otherPk, undefined);
        stamp(tbl, otherPk, undefined);
        return "retry";
      }
      keep(tbl, pk, item.hlc, item.origin, row, ov.hlc);
      setVer(tbl, pk, { hlc: tick(), origin: me, deleted: 1, hash: "", synced: 0 });
      return "skip";
    }
    return "skip";
  }

  const isUnique = (e: unknown) => /UNIQUE constraint/i.test(String((e as Error)?.message));
  const isForeign = (e: unknown) => /FOREIGN KEY constraint/i.test(String((e as Error)?.message));

  // Dos instalaciones traen las mismas filas de fábrica (el agente principal, el chat de inicio) con fechas distintas:
  // una fila que solo cambia en sus fechas no ha perdido nada, y no se guarda como versión.
  const bare = (row: Row): Row =>
    Object.fromEntries(Object.entries(row).filter(([k]) => k !== "created_at" && k !== "updated_at"));
  const alike = (tbl: string, a: Row, b: Row | undefined): boolean =>
    !!b && hashOf(tbl, bare(a)) === hashOf(tbl, bare(b));

  function applyOne(item: Item, out: Applied): void {
    const { tbl, pk } = item;
    if (tbl === "meta" && !settingTravels(String(keyOf(pk)[0]).slice("setting:".length))) return;
    if (tbl === SECRET && !travels(pk)) return;
    observe(item.hlc);
    const row = item.row ? localize(tbl, item.row) : undefined;
    const ver = verOf(tbl, pk);
    if (ver && ver.hlc === item.hlc && ver.origin === item.origin) return;
    const hash = row ? hashOf(tbl, row) : "";
    const same = !!ver && ver.deleted === (row ? 0 : 1) && ver.hash === hash;
    const mine = !!ver && ver.origin === me && ver.synced === 0;
    if (ver && !newer(item.hlc, item.origin, ver.hlc, ver.origin)) {
      if (mine && !same && row && !alike(tbl, row, readRow(tbl, pk)) && keep(tbl, pk, item.hlc, item.origin, row, ver.hlc))
        out.kept++;
      return;
    }
    if (same) return void setVer(tbl, pk, { ...(ver as Ver), hlc: item.hlc, origin: item.origin, synced: 1 });
    if (mine && ver) {
      const local = readRow(tbl, pk);
      if (local && !(row && alike(tbl, local, row)) && keep(tbl, pk, ver.hlc, me, local, item.hlc)) out.kept++;
    }
    const sender = item.origin;
    try {
      writeRow(tbl, pk, row);
    } catch (e) {
      if (!isUnique(e) || !row) throw e;
      if (clash(tbl, pk, item, row) === "skip") {
        out.kept++;
        return;
      }
      writeRow(tbl, pk, row);
    }
    // Un mensaje recolocado ya no es igual que el que envió el otro equipo: vuelve a él como cambio de este.
    if (item.origin !== sender)
      setVer(tbl, pk, { hlc: tick(), origin: me, deleted: 0, hash: hashOf(tbl, row as Row), synced: 0 });
    else setVer(tbl, pk, { hlc: item.hlc, origin: item.origin, deleted: row ? 0 : 1, hash, synced: 1 });
    out.applied++;
    out.touched.add(tbl);
  }

  return {
    /** Primera vez: todo lo que ya hay se anota. Con `low`, como «lo más antiguo» (pierde ante el otro equipo). */
    baseline(asOldest: boolean): void {
      tx(() => {
        low = asOldest;
        if (asOldest) counter = 0;
        try {
          for (const tbl of TABLES) {
            const s = shape(tbl);
            if (!s) continue;
            const keys = all<Row>(`SELECT ${s.key.map(q).join(", ")} FROM ${q(tbl)}`);
            for (const k of keys) stamp(tbl, pkOf(s, k));
          }
          for (const m of all<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'setting:%'")) stampSetting(m.key);
          scanSecrets();
          run("DELETE FROM sync_dirty");
        } finally {
          low = false;
          counter = 0;
        }
      });
    },
    seal: () => tx(seal),
    scanSecrets: () => tx(scanSecrets),
    setMove(f: ((path: string) => string) | undefined) {
      move = f;
    },
    pendingCount: () => one<{ c: number }>("SELECT count(*) AS c FROM sync_ver WHERE synced = 0")?.c ?? 0,
    /** Lo siguiente que hay que enviar, de lo más antiguo a lo más nuevo. */
    pending(limit: number, maxBytes = 4_000_000): Item[] {
      const rows = all<{ tbl: string; pk: string } & Ver>(
        "SELECT tbl, pk, hlc, origin, deleted, hash, synced FROM sync_ver WHERE synced = 0 ORDER BY hlc LIMIT ?",
        limit,
      );
      const out: Item[] = [];
      let bytes = 0;
      for (const v of rows) {
        const row = v.deleted ? undefined : readRow(v.tbl, v.pk);
        const item: Item = { tbl: v.tbl, pk: v.pk, hlc: v.hlc, origin: v.origin, del: !row, ...(row ? { row } : {}) };
        bytes += row ? stable(row).length : 0;
        out.push(item);
        if (bytes > maxBytes) break;
      }
      return out;
    },
    /** El otro equipo confirmó que los tiene. */
    acked(items: { tbl: string; pk: string; hlc: string }[]): void {
      tx(() => {
        for (const i of items)
          run("UPDATE sync_ver SET synced = 1 WHERE tbl = ? AND pk = ? AND hlc = ?", i.tbl, i.pk, i.hlc);
      });
    },
    /** Tras reconectar con un equipo que perdió su copia: todo vuelve a estar pendiente. */
    resend: () => void run("UPDATE sync_ver SET synced = 0"),
    apply(items: Item[]): Applied {
      const out: Applied = { applied: 0, kept: 0, failed: 0, touched: new Set(), waiting: [] };
      tx(() => {
        scanSecrets();
        seal();
        silently(() => {
          let queue = items;
          for (;;) {
            const later: Item[] = [];
            for (const item of queue) {
              db.exec("SAVEPOINT sync_uno");
              try {
                applyOne(item, out);
                db.exec("RELEASE sync_uno");
              } catch (e) {
                db.exec("ROLLBACK TO sync_uno; RELEASE sync_uno");
                if (isForeign(e)) later.push(item);
                else {
                  out.failed++;
                  warn(`sincronizar: no se pudo aplicar ${item.tbl}: ${(e as Error).message}`);
                }
              }
            }
            if (!later.length || later.length === queue.length) {
              out.failed += later.length;
              out.waiting.push(...later);
              break;
            }
            queue = later;
          }
        });
      });
      return out;
    },
    lost(limit = 50, offset = 0): { total: number; items: Lost[] } {
      const total = one<{ c: number }>("SELECT count(*) AS c FROM sync_perdidas")?.c ?? 0;
      const items = all<Lost>(
        `SELECT id, tbl, pk, origin, row, lost_at, recovered_at FROM sync_perdidas
         ORDER BY lost_at DESC, id LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return { total, items };
    },
    /** Devuelve una versión guardada a su sitio; lo que había pasa a ser, a su vez, una versión guardada. */
    recover(id: string): boolean {
      return tx(() => {
        const p = one<{ tbl: string; pk: string; row: string }>("SELECT tbl, pk, row FROM sync_perdidas WHERE id = ?", id);
        if (!p) return false;
        seal();
        let row = JSON.parse(p.row) as Row;
        if (p.tbl === SECRET) {
          const value = d.secrets?.resolve(`secret://${LOST_SECRET}${id}`);
          if (value === undefined) return false;
          row = { value };
        }
        const current = readRow(p.tbl, p.pk);
        const ver = verOf(p.tbl, p.pk);
        const stampNow = tick();
        if (current && hashOf(p.tbl, current) !== hashOf(p.tbl, row))
          keep(p.tbl, p.pk, ver?.hlc ?? stampNow, ver?.origin ?? me, current, stampNow);
        silently(() => writeRow(p.tbl, p.pk, row));
        stamp(p.tbl, p.pk);
        run("UPDATE sync_perdidas SET recovered_at = ? WHERE id = ?", new Date(clock()).toISOString(), id);
        stamp("sync_perdidas", JSON.stringify([id]));
        return true;
      });
    },
  };
}
export type Journal = ReturnType<typeof createJournal>;
