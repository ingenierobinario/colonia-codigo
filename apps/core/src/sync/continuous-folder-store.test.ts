import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { continuousFolderStore, type FolderRevision } from "./continuous-folder-store.ts";

const revision = (value: Buffer | string): FolderRevision => ({
  sha: createHash("sha256").update(value).digest("hex"),
  bytes: Buffer.byteLength(value),
});
function machine(t: TestContext) {
  const temp = tempDir("colonia-carpetas-");
  const home = path.join(temp.path, "colonia");
  const root = path.join(temp.path, "proyecto");
  fs.mkdirSync(home);
  fs.mkdirSync(root);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, path TEXT, registered INTEGER DEFAULT 1)");
  db.prepare("INSERT INTO projects(id,path) VALUES('p',?)").run(root);
  let active = true;
  const open = () => continuousFolderStore({ db, home, peer: "otro", project: "p", active: () => active });
  t.after(async () => {
    db.close();
    await temp.remove();
  });
  return {
    root,
    open,
    db,
    stop: () => {
      active = false;
    },
  };
}
type Store = ReturnType<typeof continuousFolderStore>;
async function send(from: Store, to: Store, name: string, base: FolderRevision | null, version: FolderRevision | null) {
  const receiver = await to.receive(name, base, version);
  if (version) {
    for (let pos = receiver.offset; pos < version.bytes; pos += 256 * 1024) {
      const chunk = await from.read(name, version, pos, Math.min(version.bytes - pos, 256 * 1024));
      await receiver.append(pos, chunk);
    }
  }
  return receiver.commit();
}

test("reanuda la recepción de un binario, comprueba su contenido y confirma sólo la carpeta autorizada", async (t) => {
  const a = machine(t),
    b = machine(t);
  const name = "piezas/archivo.bin";
  const bytes = Buffer.alloc(360_207, 42);
  fs.mkdirSync(path.join(a.root, "piezas"));
  fs.writeFileSync(path.join(a.root, name), bytes);
  const source = a.open(),
    target = b.open();
  const v = revision(bytes);
  assert.deepEqual(await source.inventory(), [{ path: name, ...v }]);
  const first = await target.receive(name, null, v);
  assert.equal(first.offset, 0);
  await first.append(0, await source.read(name, v, 0, 160_000));
  const second = await b.open().receive(name, null, v);
  assert.equal(second.offset, 160_000);
  await assert.rejects(second.append(10, Buffer.from("error")));
  assert.equal(fs.existsSync(path.join(b.root, name)), false);
  assert.deepEqual((await send(source, target, name, null, v)).version, v);
  assert.deepEqual(fs.readFileSync(path.join(b.root, name)), bytes);
  assert.equal((await target.receive(name, null, v)).offset, bytes.length);
  target.ack(name, v);
  assert.deepEqual(b.open().baselines(), [{ path: name, version: v }]);
  const moved = path.join(a.root, "otra");
  fs.mkdirSync(moved);
  b.db.prepare("UPDATE projects SET path=? WHERE id='p'").run(moved);
  await assert.rejects(target.inventory());
  assert.deepEqual(b.open().baselines(), []);
});

test("dos cambios sin conexión conservan ambas versiones y convergen también cuando se repite el envío", async (t) => {
  const a = machine(t),
    b = machine(t);
  const left = a.open(),
    right = b.open(),
    name = "plan.md";
  const original = revision("común");
  for (const m of [a, b]) fs.writeFileSync(path.join(m.root, name), "común");
  left.ack(name, original);
  right.ack(name, original);
  fs.writeFileSync(path.join(a.root, name), "escritorio");
  fs.writeFileSync(path.join(b.root, name), "servidor");
  const va = revision("escritorio"),
    vb = revision("servidor");
  const staged = await left.receive(name, original, vb);
  await staged.append(0, await right.read(name, vb, 0, vb.bytes));
  const result = await send(left, right, name, original, va);
  const other = await staged.commit();
  assert.deepEqual(result, other);
  assert.ok(result.conflict);
  assert.deepEqual(await left.inventory(), await right.inventory());
  for (const m of [a, b]) {
    const variants = [name, result.conflict].map((f) => fs.readFileSync(path.join(m.root, f), "utf8")).sort();
    assert.deepEqual(variants, ["escritorio", "servidor"]);
  }
  assert.deepEqual((await send(left, right, name, result.version, result.version)).version, result.version);
});

test("una edición sobrevive a un borrado concurrente; una eliminación confirmada se aplica sin borrar otro archivo", async (t) => {
  const a = machine(t);
  const store = a.open(),
    name = "local.txt",
    base = revision("anterior");
  const local = path.join(a.root, name);
  fs.writeFileSync(local, "anterior");
  store.ack(name, base);
  const deletion = await store.receive(name, base, null);
  fs.writeFileSync(local, "modificado");
  assert.deepEqual((await deletion.commit()).version, revision("modificado"));
  assert.equal(fs.readFileSync(local, "utf8"), "modificado");
  const ok = await store.receive(name, revision("modificado"), null);
  assert.deepEqual((await ok.commit()).version, null);
  assert.equal(fs.existsSync(local), false);
});

test("un fragmento corrupto, una autorización revocada o una ruta ajena nunca publican contenido", async (t) => {
  const a = machine(t);
  const s = a.open(),
    v = revision("bien");
  const receiver = await s.receive("doc.txt", null, v);
  await receiver.append(0, Buffer.from("otro"));
  await assert.rejects(receiver.commit());
  assert.equal(fs.existsSync(path.join(a.root, "doc.txt")), false);
  assert.equal((await s.receive("doc.txt", null, v)).offset, 0);
  fs.mkdirSync(path.join(a.root, "sub"));
  a.db.prepare("INSERT INTO projects(id,path) VALUES('vecino',?)").run(path.join(a.root, "sub"));
  for (const name of ["../externo", ".env", "sub/cosa.txt", ".apc/mcps.json", "carpeta/con"]) {
    await assert.rejects(s.receive(name, null, v));
  }
  const temp = await s.receive("doc.txt", null, v);
  await temp.append(0, Buffer.from("bien"));
  a.stop();
  await assert.rejects(temp.commit());
  assert.equal(fs.existsSync(path.join(a.root, "doc.txt")), false);
});
test("la caché persiste entre sesiones y un recorrido caliente cede el turno entre archivos", async (t) => {
  const m = machine(t);
  for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(m.root, `pieza-${i}.txt`), `dato ${i}`);
  const first = await m.open().inventory();
  assert.equal(first.length, 200);
  const reads = t.mock.method(fs, "readSync");
  const store = m.open();
  let count = 0,
    whenTimer = 0;
  const stat = fs.lstatSync;
  const stats = t.mock.method(fs, "lstatSync", (...args: Parameters<typeof stat>) => {
    if (String(args[0]).includes("pieza-") && ++count === 1)
      setImmediate(() => {
        whenTimer = count;
      });
    return stat(...args);
  });
  assert.deepEqual(await store.inventory(), first);
  assert.equal(reads.mock.callCount(), 0);
  assert.ok(whenTimer > 0 && whenTimer < count, "la consulta de la caché se interrumpe entre archivos");
  stats.mock.restore();
  reads.mock.restore();
  fs.writeFileSync(path.join(m.root, "pieza-0.txt"), "otro 0");
  const changed = await store.inventory();
  assert.deepEqual(
    changed.find((it) => it.path === "pieza-0.txt"),
    { path: "pieza-0.txt", ...revision("otro 0") },
  );
});

test("enlaces, nombres ambiguos y errores de acceso interrumpen el inventario sin convertirse en eliminaciones", async (t) => {
  const m = machine(t),
    store = m.open();
  const rel = "informe.txt",
    name = path.join(m.root, rel);
  const outside = path.join(path.dirname(m.root), "otra-carpeta");
  fs.mkdirSync(outside);
  const other = path.join(outside, "otro.txt");
  fs.writeFileSync(other, "fichero de otro proyecto");
  fs.writeFileSync(name, "propio");
  store.ack(rel, revision("propio"));
  fs.unlinkSync(name);
  fs.linkSync(other, name);
  await assert.rejects(store.inventory());
  await assert.rejects(store.receive(rel, revision("propio"), null));
  fs.unlinkSync(name);
  fs.writeFileSync(name, "propio");
  fs.symlinkSync(outside, path.join(m.root, "enlace"), "junction");
  await assert.rejects(store.receive("enlace/otro.txt", null, revision("nuevo")));
  const rejected = await store.receive("nuevo/dato", null, revision("x"));
  await rejected.append(0, Buffer.from("x"));
  fs.symlinkSync(outside, path.join(m.root, "nuevo"), "junction");
  await assert.rejects(rejected.commit());
  assert.equal(fs.existsSync(path.join(outside, "dato")), false);
  assert.equal(fs.readFileSync(other, "utf8"), "fichero de otro proyecto");
  const blocked = t.mock.method(fs.promises, "readdir", async () => {
    throw Object.assign(new Error("sin acceso"), { code: "EACCES" });
  });
  await assert.rejects(store.inventory(), /sin acceso/);
  blocked.mock.restore();
  await assert.rejects(store.receive("INFORME.TXT", null, revision("otro")));
  fs.renameSync(name, path.join(m.root, "renombrado"));
  fs.renameSync(path.join(m.root, "renombrado"), path.join(m.root, "INFORME.TXT"));
  await assert.rejects(store.inventory());
  assert.deepEqual(store.baselines(), [{ path: rel, version: revision("propio") }]);
});

test("recupera el archivo anterior si se corta el proceso entre retirarlo y publicar su reemplazo", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = "panel.txt",
    dst = path.join(m.root, rel);
  fs.writeFileSync(dst, "original");
  const incoming = await s.receive(rel, revision("original"), revision("nuevo"));
  await incoming.append(0, Buffer.from("nuevo"));
  const rename = fs.renameSync;
  const replaced = t.mock.method(fs, "renameSync", (...args: Parameters<typeof rename>) => {
    rename(...args);
    if (path.basename(String(args[0])) === rel) m.stop();
  });
  await assert.rejects(incoming.commit());
  replaced.mock.restore();
  assert.equal(fs.existsSync(dst), false);
  const fresh = continuousFolderStore({
    db: m.db,
    home: path.join(path.dirname(m.root), "colonia"),
    project: "p",
    peer: "otro",
    active: () => true,
  });
  assert.deepEqual(await fresh.inventory(), [{ path: rel, ...revision("original") }]);
  assert.equal(fs.readFileSync(dst, "utf8"), "original");
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM sync_folder_claims").get()?.n, 0);
});

test("descarta los fragmentos obsoletos y conserva carpetas preexistentes, incluso al cancelar", async (t) => {
  const m = machine(t),
    s = m.open();
  const local = path.join(m.root, ".colonia-sincronizar-local");
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, "propio.txt"), "guardar");
  for (let i = 0; i < 20; i++) {
    const f = await s.receive("cambiante.txt", null, revision(`futura versión ${i}`));
    await f.append(0, Buffer.from("futura"));
  }
  const stage = m.db.prepare("SELECT name FROM sync_folder_stage").get()?.name;
  assert.equal(typeof stage, "string");
  assert.equal(fs.readdirSync(path.join(m.root, String(stage))).length, 1);
  assert.equal(fs.readFileSync(path.join(local, "propio.txt"), "utf8"), "guardar");
});

test("un archivo fuera del límite detiene toda la comparación y la organización se envía sin campos privados", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = ".apc/organization.json";
  fs.mkdirSync(path.join(m.root, ".apc"));
  fs.writeFileSync(path.join(m.root, rel), JSON.stringify({ areas: [], roles: [], notaPersonal: "fixture local" }));
  fs.writeFileSync(path.join(m.root, ".apc/mcps.json"), '{"mcpServers":{}}');
  const file = path.join(m.root, "datos.txt");
  fs.writeFileSync(file, "valor");
  s.ack("datos.txt", revision("valor"));
  const entries = await s.inventory();
  const org = entries.find((x) => x.path === rel);
  assert.ok(org);
  assert.equal(
    entries.some((x) => x.path.endsWith("mcps.json")),
    false,
  );
  assert.equal((await s.read(rel, org, 0, org.bytes)).includes("fixture local"), false);
  const removal = await s.receive(rel, org, null);
  await assert.rejects(removal.commit(), /campos locales/);
  assert.ok(fs.readFileSync(path.join(m.root, rel), "utf8").includes("fixture local"));
  const stat = fs.lstatSync;
  const sizes = t.mock.method(fs, "lstatSync", (...args: Parameters<typeof stat>) => {
    const row = stat(...args);
    if (String(args[0]) === file && row && typeof row.size === "bigint")
      return Object.assign(row, { size: 9n * 1024n ** 3n });
    return row;
  });
  await assert.rejects(s.inventory());
  sizes.mock.restore();
  assert.deepEqual(s.baselines(), [{ path: "datos.txt", version: revision("valor") }]);
});

test("tras un corte en la publicación exclusiva completa el enlace y evita un conflicto artificial", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = "dibujo.txt";
  const dst = path.join(m.root, rel);
  fs.writeFileSync(dst, "viejo");
  const sink = await s.receive(rel, revision("viejo"), revision("nuevo"));
  await sink.append(0, Buffer.from("nuevo"));
  const unlink = fs.unlinkSync;
  const interrupted = t.mock.method(fs, "unlinkSync", (...args: Parameters<typeof unlink>) => {
    if (/^[a-f0-9]{64}$/.test(path.basename(String(args[0])))) {
      m.stop();
      throw new Error("corte simulado");
    }
    unlink(...args);
  });
  await assert.rejects(sink.commit());
  interrupted.mock.restore();
  const fresh = continuousFolderStore({
    db: m.db,
    home: path.join(path.dirname(m.root), "colonia"),
    project: "p",
    peer: "otro",
    active: () => true,
  });
  assert.deepEqual(await fresh.inventory(), [{ path: rel, ...revision("nuevo") }]);
  assert.equal(fs.statSync(dst).nlink, 1);
  assert.equal(m.db.prepare("SELECT count(*) AS n FROM sync_folder_links").get()?.n, 0);
});
test("reemplazar el temporal por otro archivo nunca permite anexar, confirmar ni limpiar el contenido ajeno", async (t) => {
  const m = machine(t),
    s = m.open(),
    v = revision("aprobado");
  const sink = await s.receive("dato.txt", null, v);
  const folder = m.db.prepare("SELECT name FROM sync_folder_stage").get()?.name;
  const part = m.db.prepare("SELECT name FROM sync_folder_parts").get()?.name;
  const dst = path.join(m.root, String(folder), String(part));
  fs.renameSync(dst, `${dst}-original`);
  fs.writeFileSync(dst, "externo");
  await assert.rejects(sink.append(7, Buffer.from("x")));
  await assert.rejects(sink.commit());
  await assert.rejects(s.receive("dato.txt", null, revision("otra")));
  assert.equal(fs.readFileSync(dst, "utf8"), "externo");
  assert.equal(fs.existsSync(path.join(m.root, "dato.txt")), false);
});

test("una actualización confirmada conserva los permisos locales de ejecución", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = "programa.sh",
    dst = path.join(m.root, rel);
  fs.writeFileSync(dst, "previo", { mode: 0o750 });
  const mode = fs.statSync(dst).mode & 0o777;
  const sink = await s.receive(rel, revision("previo"), revision("actual"));
  await sink.append(0, Buffer.from("actual"));
  assert.deepEqual((await sink.commit()).version, revision("actual"));
  assert.equal(fs.statSync(dst).mode & 0o777, mode);
});

test("en un volumen sin publicación exclusiva no se retira el archivo original", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = "plano.txt",
    dest = path.join(m.root, rel);
  fs.writeFileSync(dest, "anterior");
  const sink = await s.receive(rel, revision("anterior"), revision("nuevo"));
  await sink.append(0, Buffer.from("nuevo"));
  const block = t.mock.method(fs, "linkSync", () => {
    throw Object.assign(new Error("volumen sin enlaces"), { code: "ENOTSUP" });
  });
  await assert.rejects(sink.commit(), /enlaces físicos/);
  block.mock.restore();
  assert.equal(fs.readFileSync(dest, "utf8"), "anterior");
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM sync_folder_claims").get()?.n, 0);
});

test("conserva incluso una edición sobre el descriptor anterior mientras se publica la nueva versión", async (t) => {
  const m = machine(t),
    s = m.open(),
    rel = "escrito.txt",
    dst = path.join(m.root, rel);
  fs.writeFileSync(dst, "anterior");
  const sink = await s.receive(rel, revision("anterior"), revision("remoto"));
  await sink.append(0, Buffer.from("remoto"));
  const fd = fs.openSync(dst, "r+");
  const link = fs.linkSync;
  const modified = t.mock.method(fs, "linkSync", (...args: Parameters<typeof link>) => {
    link(...args);
    if (path.basename(String(args[1])) === rel) {
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, Buffer.from("edición local"), 0, Buffer.byteLength("edición local"), 0);
    }
  });
  try {
    await assert.rejects(sink.commit());
  } finally {
    modified.mock.restore();
    fs.closeSync(fd);
  }
  const entries = await s.inventory();
  assert.equal(entries.length, 2);
  assert.equal(fs.readFileSync(dst, "utf8"), "remoto");
  const conflict = entries.find((entry) => entry.path !== rel);
  assert.ok(conflict);
  assert.equal(fs.readFileSync(path.join(m.root, conflict.path), "utf8"), "edición local");
});
