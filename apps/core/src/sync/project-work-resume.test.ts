import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { install } from "./journal.ts";
import { projectWork, validateWorkSelection, type WorkLink } from "./project-work.ts";

test("retoma los bytes ya recibidos y recupera el acuse perdido sin instalar dos veces", async (t) => {
  const world = tempDir("colonia-archivos-interrumpidos-");
  const desk = path.join(world.path, "escritorio"),
    server = path.join(world.path, "servidor");
  fs.mkdirSync(desk);
  fs.mkdirSync(server);
  const source = openDb(desk),
    target = openDb(server);
  t.after(async () => {
    source.close();
    target.close();
    await world.remove();
  });
  install(source);
  install(target);
  const root = path.join(desk, "projects", "producto");
  fs.mkdirSync(root, { recursive: true });
  for (const db of [source, target])
    db.prepare("INSERT INTO projects(id,name,path,created_at) VALUES(?,?,?,?)").run(
      "p_prueba",
      "Producto",
      root,
      new Date().toISOString(),
    );
  const binary = randomBytes(1024 * 1024 + 93);
  fs.writeFileSync(path.join(root, "grande.dat"), binary);
  const silent = () => {};
  const sourcePeer = "1".repeat(32),
    serverPeer = "2".repeat(32);
  const openSource = () => projectWork(source, desk, serverPeer, "send", silent, silent);
  const openTarget = () => projectWork(target, server, sourcePeer, "receive", silent, silent);
  let sender = openSource(),
    recipient = openTarget();
  type Frame = Parameters<WorkLink["send"]>[0];
  const outgoing: Frame[] = [],
    incoming: Frame[] = [];
  const deskLink: WorkLink = { send: (m) => outgoing.push(m) };
  const serverLink: WorkLink = { send: (m) => incoming.push(m) };
  const onServer = async () => {
    const m = outgoing.shift();
    assert.ok(m);
    await recipient.receive(serverLink, m);
  };
  const next = () => {
    const m = incoming.shift();
    assert.ok(m);
    return m;
  };
  sender.select(["p_prueba"]);
  await sender.pump(deskLink, true);
  await onServer();
  await sender.receive(deskLink, next());
  await onServer();
  const interrupted = next();
  assert.ok(interrupted.op === "next" && interrupted.at > 0 && interrupted.at < binary.length);
  sender.dispose(false);
  recipient.dispose(false);
  sender = openSource();
  recipient = openTarget();
  await sender.pump(deskLink, true);
  await onServer();
  let m = next();
  assert.deepEqual(m, interrupted);
  while (m.op === "next") {
    await sender.receive(deskLink, m);
    await onServer();
    m = next();
  }
  assert.equal(m.op, "done");
  const count = () => target.prepare("SELECT count(*) n FROM sync_work_receipts").get()?.n;
  assert.equal(count(), 1);
  const copy = target.prepare("SELECT path FROM projects WHERE id='p_prueba'").get()?.path;
  assert.equal(typeof copy, "string");
  assert.deepEqual(fs.readFileSync(path.join(String(copy), "grande.dat")), binary);
  assert.equal(sender.status()?.completed, 0);
  // Se pierde el último mensaje después de vincular la carpeta, con el escritorio todavía pendiente.
  sender.dispose(false);
  sender = openSource();
  await sender.pump(deskLink, true);
  await onServer();
  const receipt = next();
  assert.deepEqual(receipt, m);
  if (receipt.op !== "done") throw new Error("Falta el acuse verificado");
  await sender.receive(deskLink, { ...receipt, sha: "a".repeat(64) });
  assert.equal(sender.status()?.completed, 0);
  await sender.receive(deskLink, receipt);
  assert.equal(sender.status()?.completed, 1);
  assert.equal(count(), 1);
  assert.equal(projectWork(source, desk, "3".repeat(32), "send", silent, silent).status(), undefined);
});

for (const scenario of [
  "antes de preparar",
  "con el archivo preparado",
  "misma ruta física sustituida",
  "cola antigua",
] as const) {
  test(`la copia inicial solicita nueva selección al cambiar de carpeta: ${scenario}`, async (t) => {
    const world = tempDir("colonia-consentimiento-");
    const home = path.join(world.path, "colonia"),
      a = path.join(world.path, "carpeta-a"),
      b = path.join(world.path, "carpeta-b");
    for (const dir of [home, a, b]) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(a, "solo-a.txt"), "elegida inicialmente");
    fs.writeFileSync(path.join(b, "solo-b.txt"), "requiere otro consentimiento");
    const db = openDb(home);
    t.after(async () => {
      db.close();
      await world.remove();
    });
    install(db);
    db.prepare("INSERT INTO projects(id,name,path,created_at) VALUES('p_prueba','Mi proyecto',?,?)").run(
      a,
      new Date().toISOString(),
    );
    const peer = "5".repeat(32);
    const open = () =>
      projectWork(
        db,
        home,
        peer,
        "send",
        () => {},
        () => {},
      );
    const frames: Parameters<WorkLink["send"]>[0][] = [];
    const channel: WorkLink = { send: (m) => frames.push(m) };
    let sender = open();
    sender.select(["p_prueba"]);
    if (scenario !== "antes de preparar") {
      await sender.pump(channel, true);
      assert.equal(frames.shift()?.op, "start");
    }
    sender.dispose(false);
    const meta = path.join(home, "sync-proyectos", peer, "solicitud.json");
    if (scenario === "cola antigua") {
      const state = JSON.parse(fs.readFileSync(meta, "utf8"));
      for (const job of state.jobs) delete job.folder;
      fs.writeFileSync(meta, JSON.stringify(state));
    } else if (scenario === "misma ruta física sustituida") {
      fs.renameSync(a, path.join(world.path, "a-conservada"));
      fs.renameSync(b, a);
    } else {
      db.prepare("UPDATE projects SET path=? WHERE id='p_prueba'").run(b);
    }
    sender = open();
    await sender.pump(channel, true);
    assert.deepEqual(
      frames.map((f) => f.op),
      [],
      "una reanudación no autoriza otra carpeta",
    );
    assert.equal(sender.status()?.why, "selection");
    assert.throws(() => sender.select());
    // Elegir explícitamente la ruta actual autoriza sólo esta raíz y no borra documentos de ambas carpetas.
    sender.select(["p_prueba"]);
    if (scenario === "con el archivo preparado") db.prepare("UPDATE projects SET present=0 WHERE id='p_prueba'").run();
    await sender.pump(channel, true);
    assert.deepEqual(
      frames.map((f) => f.op),
      ["start"],
    );
    const old = scenario === "misma ruta física sustituida" ? path.join(world.path, "a-conservada") : a;
    const fresh = scenario === "misma ruta física sustituida" ? a : b;
    assert.equal(fs.readFileSync(path.join(old, "solo-a.txt"), "utf8"), "elegida inicialmente");
    assert.equal(fs.readFileSync(path.join(fresh, "solo-b.txt"), "utf8"), "requiere otro consentimiento");
    const serverHome = path.join(world.path, "servidor");
    fs.mkdirSync(serverHome);
    const target = openDb(serverHome);
    try {
      install(target);
      target
        .prepare("INSERT INTO projects(id,name,path,created_at) VALUES('p_prueba','Mi proyecto',?,?)")
        .run(path.join(serverHome, "antigua"), new Date().toISOString());
      const recipient = projectWork(
        target,
        serverHome,
        "6".repeat(32),
        "receive",
        () => {},
        () => {},
      );
      const replies: Parameters<WorkLink["send"]>[0][] = [];
      const serverChannel: WorkLink = { send: (m) => replies.push(m) };
      for (let i = 0; i < 8 && frames.length; i++) {
        const msg = frames.shift();
        assert.ok(msg);
        await recipient.receive(serverChannel, msg);
        const reply = replies.shift();
        assert.ok(reply);
        await sender.receive(channel, reply);
      }
      assert.equal(sender.status()?.state, "done");
      const copied = target.prepare("SELECT path FROM projects WHERE id='p_prueba'").get()?.path;
      assert.ok(typeof copied === "string");
      const content = scenario === "cola antigua" ? "solo-a.txt" : "solo-b.txt";
      const other = scenario === "cola antigua" ? "solo-b.txt" : "solo-a.txt";
      assert.equal(fs.existsSync(path.join(copied, content)), true);
      assert.equal(fs.existsSync(path.join(copied, other)), false);
    } finally {
      target.close();
    }
    const persisted = JSON.parse(fs.readFileSync(meta, "utf8"));
    assert.ok(persisted.jobs[0].folder);
  });
}

test("el consentimiento previo al saludo y el permiso de leer cada fragmento están ligados a la misma raíz", async (t) => {
  const area = tempDir("colonia-saludo-carpetas-");
  const home = path.join(area.path, "colonia"),
    a = path.join(area.path, "a"),
    b = path.join(area.path, "b");
  for (const dir of [home, a, b]) fs.mkdirSync(dir);
  const db = openDb(home);
  t.after(async () => {
    db.close();
    await area.remove();
  });
  install(db);
  db.prepare("INSERT INTO projects(id,name,path,created_at) VALUES('p','Prueba',?,?)").run(a, new Date().toISOString());
  const set = (p: string) => db.prepare("UPDATE projects SET path=? WHERE id='p'").run(p);
  const choice = validateWorkSelection(db, ["p"]);
  const sender = projectWork(
    db,
    home,
    "9".repeat(32),
    "send",
    () => {},
    () => {},
  );
  const frames: Parameters<WorkLink["send"]>[0][] = [];
  const link: WorkLink = { send: (m) => frames.push(m) };
  set(b);
  sender.selectCaptured(choice);
  await sender.pump(link, true);
  assert.equal(sender.status()?.why, "selection");
  assert.equal(frames.length, 0);
  sender.select(["p"]);
  await sender.pump(link, true);
  const offer = frames.shift();
  assert.ok(offer?.op === "start");
  set(a);
  await sender.receive(link, { op: "next", transfer: offer.transfer, at: 0 });
  assert.equal(frames.length, 0);
  assert.equal(sender.status()?.why, "selection");
});
