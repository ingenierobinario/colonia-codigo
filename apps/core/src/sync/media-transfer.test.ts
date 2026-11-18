import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { openDb } from "../db/db.ts";
import { readMediaFile } from "../services/media-file.ts";
import { tempDir } from "../testkit/platform.ts";
import { createJournal, install } from "./journal.ts";
import { MEDIA_CHUNK, type MediaPeer, mediaTransfer } from "./media-transfer.ts";

type Frame = Parameters<MediaPeer["send"]>[0];
function machine(t: TestContext, bytes: number, signed = true) {
  const dir = tempDir("colonia-medios-");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE media(id TEXT PRIMARY KEY,bytes INTEGER,path TEXT)");
  const dest = path.join(dir.path, "media", "archivos", "informe.bin");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  db.prepare("INSERT INTO media VALUES('m',?,?)").run(bytes, dest);
  t.after(async () => {
    db.close();
    await dir.remove();
  });
  const frames: Frame[] = [],
    errors: unknown[] = [];
  const peer: MediaPeer = { mediaDigests: signed, send: (m) => frames.push(m) };
  const open = () =>
    mediaTransfer(
      db,
      dir.path,
      () => "equipo-autorizado",
      () => peer,
      () => {},
      (e) => errors.push(e),
    );
  const next = () => {
    const m = frames.shift();
    assert.ok(m);
    return m;
  };
  return { dir, db, dest, frames, errors, peer, open, next };
}

test("entre dos motores se retoma el fragmento reconocido y se comprueban todos los bytes antes de publicarlos", async (t) => {
  const data = Buffer.alloc(MEDIA_CHUNK + 192, 83),
    source = machine(t, data.length),
    target = machine(t, data.length);
  fs.writeFileSync(source.dest, data);
  const send = source.open();
  let receive = target.open();
  receive.want("m");
  await send.send(source.peer, "m", 0);
  const first = source.next();
  assert.ok(first.t === "fichero" && !first.last && first.sha);
  target.next();
  await receive.receive(target.peer, first);
  target.next();
  assert.equal(fs.existsSync(target.dest), false);
  receive.clear();
  receive = target.open();
  receive.missing();
  const resumed = target.next();
  assert.ok(resumed.t === "pide");
  assert.equal(resumed.at, MEDIA_CHUNK);
  await send.send(source.peer, "m", resumed.at);
  const final = source.next();
  assert.ok(final.t === "fichero" && final.last);
  assert.equal(final.sha, createHash("sha256").update(data).digest("hex"));
  await receive.receive(target.peer, final);
  assert.deepEqual(fs.readFileSync(target.dest), data);
  assert.equal(target.db.prepare("SELECT COUNT(*) AS n FROM sync_media_parts").get()?.n, 0);
});

test("un contenido que no coincide con la suma se descarta y vuelve a pedirse desde el principio", async (t) => {
  const data = Buffer.from("adjunto íntegro"),
    source = machine(t, data.length),
    target = machine(t, data.length);
  fs.writeFileSync(source.dest, data);
  const send = source.open(),
    receive = target.open();
  receive.want("m");
  target.next();
  await send.send(source.peer, "m", 0);
  const m = source.next();
  assert.ok(m.t === "fichero");
  await receive.receive(target.peer, { ...m, data: Buffer.alloc(data.length, 87).toString("base64") });
  assert.equal(fs.existsSync(target.dest), false);
  const repeat = target.next();
  assert.ok(repeat.t === "pide" && repeat.at === 0);
  await receive.receive(target.peer, m);
  assert.deepEqual(fs.readFileSync(target.dest), data);
});

test("la publicación exclusiva mantiene el archivo del dueño que apareció a mitad de la recepción", async (t) => {
  const data = Buffer.from("procedente del otro equipo"),
    source = machine(t, data.length),
    target = machine(t, data.length);
  fs.writeFileSync(source.dest, data);
  const send = source.open(),
    receive = target.open();
  receive.want("m");
  target.next();
  await send.send(source.peer, "m", 0);
  const final = source.next();
  assert.ok(final.t === "fichero");
  fs.writeFileSync(target.dest, "de la persona");
  await receive.receive(target.peer, final);
  assert.equal(fs.readFileSync(target.dest, "utf8"), "de la persona");
  fs.renameSync(target.dest, `${target.dest}.propio`);
  receive.clear();
  receive.missing();
  const resume = target.next();
  assert.ok(resume.t === "pide");
  assert.equal(resume.at, data.length);
  await send.send(source.peer, "m", resume.at);
  const end = source.next();
  assert.ok(end.t === "fichero");
  await receive.receive(target.peer, end);
  assert.deepEqual(fs.readFileSync(target.dest), data);
  assert.equal(fs.readFileSync(`${target.dest}.propio`, "utf8"), "de la persona");
});

test("solo se ofrecen adjuntos regulares del almacén privado de medios", async (t) => {
  const f = machine(t, 4),
    send = f.open();
  fs.writeFileSync(f.dest, "uno!");
  const other = path.join(f.dir.path, "separado");
  fs.mkdirSync(other);
  const elsewhere = path.join(other, "ficha");
  fs.writeFileSync(elsewhere, "otro");
  const denied = async () => {
    await send.send(f.peer, "m", 0);
    const m = f.next();
    assert.ok(m.t === "fichero" && m.missing && !m.data);
  };
  fs.linkSync(f.dest, path.join(other, "doble"));
  await denied();
  f.db.prepare("UPDATE media SET path=?").run(elsewhere);
  await denied();
  const junction = path.join(f.dir.path, "media", "enlace");
  fs.symlinkSync(other, junction, "junction");
  f.db.prepare("UPDATE media SET path=?").run(path.join(junction, "ficha"));
  await denied();
  assert.equal(fs.readFileSync(elsewhere, "utf8"), "otro");
});

test("un par antiguo entrega sus adjuntos y un corte reinicia desde cero al faltar una suma verificable", async (t) => {
  const data = Buffer.alloc(MEDIA_CHUNK + 12, 92),
    f = machine(t, data.length, false);
  let receive = f.open();
  receive.want("m");
  f.next();
  const first = {
    t: "fichero" as const,
    id: "m",
    at: 0,
    data: data.subarray(0, MEDIA_CHUNK).toString("base64"),
    last: false,
    missing: false,
  };
  await receive.receive(f.peer, first);
  f.next();
  receive.clear();
  receive = f.open();
  receive.missing();
  const again = f.next();
  assert.ok(again.t === "pide" && again.at === 0);
  await receive.receive(f.peer, first);
  f.next();
  await receive.receive(f.peer, {
    ...first,
    at: MEDIA_CHUNK,
    last: true,
    data: data.subarray(MEDIA_CHUNK).toString("base64"),
  });
  assert.deepEqual(fs.readFileSync(f.dest), data);
});

test("si cambia el adjunto de igual tamaño durante un corte, el receptor empieza de nuevo y comprueba la versión actual", async (t) => {
  const old = Buffer.alloc(MEDIA_CHUNK + 35, 4),
    fresh = Buffer.alloc(old.length, 6),
    a = machine(t, old.length),
    b = machine(t, old.length);
  fs.writeFileSync(a.dest, old);
  const send = a.open();
  let receiver = b.open();
  receiver.want("m");
  b.next();
  await send.send(a.peer, "m", 0);
  const first = a.next();
  assert.ok(first.t === "fichero");
  await receiver.receive(b.peer, first);
  b.next();
  receiver.clear();
  receiver = b.open();
  receiver.missing();
  const resume = b.next();
  assert.ok(resume.t === "pide" && resume.at === MEDIA_CHUNK);
  fs.writeFileSync(a.dest, fresh);
  await send.send(a.peer, "m", resume.at);
  const changed = a.next();
  assert.ok(changed.t === "fichero" && changed.last);
  await receiver.receive(b.peer, changed);
  const restarted = b.next();
  assert.ok(restarted.t === "pide" && restarted.at === 0);
  await send.send(a.peer, "m", 0);
  const head = a.next();
  assert.ok(head.t === "fichero");
  await receiver.receive(b.peer, head);
  const tail = b.next();
  assert.ok(tail.t === "pide");
  await send.send(a.peer, "m", tail.at);
  const last = a.next();
  assert.ok(last.t === "fichero");
  await receiver.receive(b.peer, last);
  assert.deepEqual(fs.readFileSync(b.dest), fresh);
});

test("el diario localiza las fichas antiguas antes de validarlas y conserva la ruta legítima registrada", async (t) => {
  const home = tempDir("colonia-rutas-adjuntos-");
  const db = openDb(home.path);
  t.after(async () => {
    db.close();
    await home.remove();
  });
  install(db);
  const j = createJournal({ db, home: home.path, me: "servidor" });
  const legitimate = path.join(home.path, "media", "uploads", "2026-11-18", "informe.bin");
  const wrong = path.join(home.path, "propio.txt");
  j.setMove((p) => (p === "/anterior/media/informe.bin" ? legitimate : p));
  const row = {
    id: "m_prueba",
    kind: "file",
    mime: "application/octet-stream",
    bytes: 4,
    path: "/anterior/media/informe.bin",
    created_at: "2026-11-18T00:00:00Z",
  };
  const item = {
    tbl: "media",
    pk: JSON.stringify([row.id]),
    origin: "escritorio",
    hlc: "1800000000000-00001",
    del: false,
    row,
  };
  j.apply([item]);
  const saved = () => db.prepare("SELECT path FROM media WHERE id=?").get(row.id)?.path;
  assert.equal(saved(), legitimate);
  fs.mkdirSync(path.dirname(legitimate), { recursive: true });
  fs.writeFileSync(legitimate, "bien");
  fs.writeFileSync(wrong, "otro");
  assert.equal(readMediaFile(home.path, String(saved()), 4).toString(), "bien");
  j.apply([{ ...item, hlc: "1800000000001-00002", row: { ...row, path: wrong } }]);
  assert.equal(saved(), legitimate);
  db.prepare("UPDATE media SET path=? WHERE id=?").run(wrong, row.id);
  j.seal();
  assert.equal(
    j.pending(1000).some((v) => v.tbl === "media" && v.pk === item.pk),
    false,
  );
  assert.throws(() => readMediaFile(home.path, wrong, 4));
});
