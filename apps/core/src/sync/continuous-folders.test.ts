import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { continuousFolders, type FolderLink } from "./continuous-folders.ts";

type Message = Parameters<FolderLink["send"]>[0];
function fixture(t: TestContext) {
  let clock = Date.now();
  const now = () => clock;
  function site(peer: string) {
    const tmp = tempDir("colonia-protocolo-carpetas-"),
      home = path.join(tmp.path, "colonia"),
      root = path.join(tmp.path, "proyecto");
    fs.mkdirSync(home);
    fs.mkdirSync(root);
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, path TEXT,registered INTEGER,present INTEGER)");
    db.prepare("INSERT INTO projects VALUES('p',?,1,1)").run(root);
    const open = () => continuousFolders(db, home, peer, false, () => {}, now);
    const side = { db, root, open, sync: open() };
    t.after(async () => {
      side.sync.dispose(false);
      db.close();
      await tmp.remove();
    });
    return side;
  }
  const left = site("par-derecho"),
    right = site("par-izquierdo");
  const queue: { from: "left" | "right"; msg: Message }[] = [];
  const history: typeof queue = [];
  const wire = (from: "left" | "right"): FolderLink => ({
    send(msg) {
      history.push({ from, msg });
      queue.push({ from, msg });
    },
  });
  let a = wire("left"),
    b = wire("right");
  function connect(supported = true) {
    queue.length = 0;
    a = wire("left");
    b = wire("right");
    left.sync.attach(a, supported);
    right.sync.attach(b, supported);
  }
  async function until(check: () => boolean) {
    await waitFor(
      async () => {
        if (check()) return true;
        clock += 32;
        left.sync.pump();
        right.sync.pump();
        const item = queue.shift();
        if (item?.from === "left") await right.sync.receive(b, item.msg);
        else if (item) await left.sync.receive(a, item.msg);
        return check();
      },
      "intercambio confirmado por ambos equipos",
      { ms: 15_000, every: 2 },
    );
  }
  const advance = () => {
    clock += 5000;
    left.sync.pump();
    right.sync.pump();
  };
  const state = (site: typeof left) => site.sync.status().projects.find((p) => p.id === "p");
  const settled = () => state(left)?.state === "current" && state(right)?.state === "current" && !queue.length;
  return { left, right, history, until, connect, advance, settled, state, queue };
}

test("solo la autorización bilateral abre el disco y transmite, y los binarios reanudan desde el último bloque recibido", async (t) => {
  const { left, right, history, until, connect, advance, settled, state, queue } = fixture(t);
  connect(false);
  assert.equal(history.length, 0);
  const scanned = () => right.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_folder_baselines'").get();
  left.sync.set("p", true);
  advance();
  assert.equal(scanned(), undefined);
  assert.equal(left.sync.status().supported, false);
  connect();
  await until(() => Boolean(state(right)?.remote) && !queue.length);
  assert.equal(state(right)?.local, false);
  advance();
  assert.equal(scanned(), undefined);
  const size = 900011;
  const bytes = Buffer.alloc(size, 153);
  const same = Buffer.alloc(512011, 99);
  fs.writeFileSync(path.join(left.root, "igual.bin"), same);
  fs.writeFileSync(path.join(right.root, "igual.bin"), same);
  fs.writeFileSync(path.join(left.root, "nuevo.bin"), bytes);
  right.sync.set("p", true);
  await until(() => history.some((x) => x.from === "right" && x.msg.op === "pull" && x.msg.at === 256 * 1024));
  left.sync.dispose(false);
  right.sync.dispose(false);
  queue.length = 0;
  left.sync = left.open();
  right.sync = right.open();
  const before = history.length;
  connect();
  await until(settled);
  const pull = history.slice(before).find((x) => x.from === "right" && x.msg.op === "pull")?.msg;
  assert.ok(pull?.op === "pull");
  assert.equal(pull.at, 256 * 1024);
  const sent = () =>
    history.reduce((n, x) => n + (x.msg.op === "block" ? Buffer.byteLength(x.msg.data, "base64") : 0), 0);
  assert.equal(sent(), size);
  assert.deepEqual(fs.readFileSync(path.join(right.root, "nuevo.bin")), bytes);
  const quiet = history.length;
  advance();
  await until(() => history.length > quiet || settled());
  assert.equal(sent(), size);
  fs.writeFileSync(path.join(left.root, "solo-esta-vez.txt"), "cinco");
  advance();
  await until(() => fs.existsSync(path.join(right.root, "solo-esta-vez.txt")));
  assert.equal(sent(), size + 5);
  await until(settled);
  fs.unlinkSync(path.join(left.root, "solo-esta-vez.txt"));
  advance();
  await until(() => !fs.existsSync(path.join(right.root, "solo-esta-vez.txt")));
  assert.equal(sent(), size + 5);
  right.sync.set("p", false);
  await until(() => !state(left)?.remote);
  fs.writeFileSync(path.join(left.root, "sin-autorizacion.txt"), "Privado");
  const beforeOff = history.filter((x) => x.msg.op === "offer").length;
  advance();
  await sleep(10);
  advance();
  await sleep(10);
  assert.equal(history.filter((x) => x.msg.op === "offer").length, beforeOff);
  assert.equal(fs.existsSync(path.join(right.root, "sin-autorizacion.txt")), false);
});

test("al cambiar la carpeta del proyecto el vínculo no comparte automáticamente la nueva ubicación", async (t) => {
  const { left, right, until, connect, advance, settled, state } = fixture(t);
  left.sync.set("p", true);
  right.sync.set("p", true);
  connect();
  await until(settled);
  const replacement = path.join(path.dirname(left.root), "privado");
  fs.mkdirSync(replacement);
  fs.writeFileSync(path.join(replacement, "solo-local.txt"), "permanecer aquí");
  left.db.prepare("UPDATE projects SET path=? WHERE id='p'").run(replacement);
  advance();
  await until(() => !state(right)?.remote);
  assert.equal(state(left)?.local, false);
  assert.equal(fs.existsSync(path.join(right.root, "solo-local.txt")), false);
});

test("un acuse perdido no resucita la versión anterior sobre un cambio más reciente en el receptor", async (t) => {
  const { left, right, until, connect, settled, queue, history } = fixture(t);
  const local = path.join(left.root, "nota.txt"),
    remote = path.join(right.root, "nota.txt");
  fs.writeFileSync(local, "Primera nota");
  left.sync.set("p", true);
  right.sync.set("p", true);
  connect();
  await until(() => queue.some((x) => x.from === "right" && x.msg.op === "done") && fs.existsSync(remote));
  assert.equal(fs.readFileSync(remote, "utf8"), "Primera nota");
  left.sync.dispose(false);
  right.sync.dispose(false);
  fs.writeFileSync(remote, "Nueva nota en el receptor");
  left.sync = left.open();
  right.sync = right.open();
  connect();
  await until(settled);
  assert.equal(fs.readFileSync(local, "utf8"), "Nueva nota en el receptor");
  assert.equal(fs.readFileSync(remote, "utf8"), "Nueva nota en el receptor");
  assert.equal(fs.existsSync(path.join(right.root, "Conflictos de Colonia")), false);
  const bytes = history
    .filter((v) => v.msg.op === "block")
    .reduce((n, v) => n + (v.msg.op === "block" ? Buffer.byteLength(v.msg.data, "base64") : 0), 0);
  assert.equal(bytes, Buffer.byteLength("Primera notaNueva nota en el receptor"));
});
