import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { install } from "./journal.ts";
import { projectWork, type WorkLink } from "./project-work.ts";

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
