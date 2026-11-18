import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { createJournal, install } from "./journal.ts";
import { hasProjectWork, installProjectWork, prepareProjectWork } from "./project-work-archive.ts";

test("el traslado conserva la carpeta y los cambios de cada equipo, y solo confirma el proyecto pedido", async (t) => {
  const area = tempDir("colonia-traslado-carpetas-");
  const dbs: ReturnType<typeof openDb>[] = [];
  t.after(async () => {
    for (const db of dbs) db.close();
    await area.remove();
  });
  const make = (name: string) => {
    const home = path.join(area.path, name);
    fs.mkdirSync(home, { recursive: true });
    const db = openDb(home);
    dbs.push(db);
    install(db);
    return { home, db, journal: createJournal({ db, me: name }) };
  };
  const host = make("servidor"),
    desk = make("escritorio");
  const root = path.join(desk.home, "projects", "estudio");
  const nested = path.join(root, "otro");
  fs.mkdirSync(nested, { recursive: true });
  const add = (db: ReturnType<typeof openDb>, id: string, root: string) =>
    db
      .prepare("INSERT INTO projects(id,name,path,created_at) VALUES(?,?,?,?)")
      .run(id, id, root, new Date().toISOString());
  add(desk.db, "p_estudio", root);
  add(desk.db, "p_vecino", nested);
  fs.writeFileSync(path.join(nested, "ajeno.txt"), "solo del vecino");
  fs.writeFileSync(path.join(root, ".env"), "solo de la máquina");
  const bytes = Buffer.alloc(350_123, 91);
  fs.writeFileSync(path.join(root, "informe.dat"), bytes);
  fs.mkdirSync(path.join(root, ".codex", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "agents", "lectura.toml"), 'name = "lectura"');
  const destinationOriginal = path.join(host.home, "antiguo");
  fs.mkdirSync(destinationOriginal, { recursive: true });
  fs.writeFileSync(path.join(destinationOriginal, "previo.txt"), "conservar");
  add(host.db, "p_estudio", destinationOriginal);
  add(host.db, "p_vecino", path.join(host.home, "vecino"));
  const password = "solo para esta prueba";
  const archiveFile = path.join(area.path, "documentos.colonia");
  const expected = await prepareProjectWork(desk.db, desk.home, "p_estudio", archiveFile, password);
  assert.equal(expected.files, 2);
  assert.ok(expected.bytes > 350000);
  const sha = createHash("sha256").update(fs.readFileSync(archiveFile)).digest("hex");
  const common = {
    sha,
    db: host.db,
    home: host.home,
    project: "p_estudio",
    archiveFile,
    password,
    ...expected,
    peer: "escritorio",
    transfer: "entrega-uno",
  };
  assert.equal(hasProjectWork(host.db, "escritorio", "entrega-uno", "p_estudio", sha), false);
  await assert.rejects(installProjectWork({ ...common, project: "p_vecino" }));
  await assert.rejects(installProjectWork({ ...common, password: "contraseña incorrecta" }));
  await assert.rejects(installProjectWork({ ...common, files: expected.files + 1 }));
  let checks = 0;
  await assert.rejects(
    installProjectWork({
      ...common,
      active: () => {
        checks++;
        return checks < 4;
      },
    }),
  );
  assert.equal(checks, 4);
  assert.deepEqual(fs.readdirSync(path.join(host.home, "projects")), []);
  const location = () => String(host.db.prepare("SELECT path FROM projects WHERE id='p_estudio'").get()?.path);
  assert.equal(location(), destinationOriginal);
  assert.equal(hasProjectWork(host.db, "escritorio", "entrega-uno", "p_estudio", sha), false);
  await Promise.all([installProjectWork(common), installProjectWork(common)]);
  const received = location();
  assert.notEqual(received, destinationOriginal);
  assert.deepEqual(fs.readFileSync(path.join(received, "informe.dat")), bytes);
  assert.equal(fs.existsSync(path.join(received, ".env")), false);
  assert.equal(fs.existsSync(path.join(received, "otro")), false);
  assert.ok(fs.existsSync(path.join(received, ".codex", "agents", "lectura.toml")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(received, ".apc", "project.json"), "utf8")).colonia_id, "estudio");
  assert.equal(fs.readFileSync(path.join(destinationOriginal, "previo.txt"), "utf8"), "conservar");
  assert.equal(hasProjectWork(host.db, "escritorio", "entrega-uno", "p_estudio", sha), true);
  assert.throws(() => hasProjectWork(host.db, "escritorio", "entrega-uno", "p_vecino", sha));
  await assert.rejects(installProjectWork({ ...common, sha: "f".repeat(64) }));
  const count = fs.readdirSync(path.join(host.home, "projects")).length;
  await installProjectWork(common);
  assert.equal(fs.readdirSync(path.join(host.home, "projects")).length, count);
  host.journal.baseline(true);
  desk.journal.baseline(false);
  host.journal.apply(desk.journal.pending(100));
  assert.equal(location(), received);
  host.db.prepare("UPDATE projects SET name='Proyecto recibido' WHERE id='p_estudio'").run();
  host.journal.seal();
  const outbound = host.journal.pending(100);
  assert.ok(!JSON.stringify(outbound).includes(JSON.stringify(received).slice(1, -1)));
  desk.journal.apply(outbound);
  const remote = desk.db.prepare("SELECT name,path FROM projects WHERE id='p_estudio'").get();
  assert.equal(remote?.name, "Proyecto recibido");
  assert.equal(remote?.path, root);
  const chosen = path.join(host.home, "nueva-ubicacion");
  fs.mkdirSync(chosen, { recursive: true });
  host.db.prepare("UPDATE projects SET path=? WHERE id='p_estudio'").run(chosen);
  host.journal.seal();
  desk.db.prepare("UPDATE projects SET name='Nuevo título' WHERE id='p_estudio'").run();
  desk.journal.seal();
  host.journal.apply(desk.journal.pending(100));
  assert.equal(location(), chosen);
  assert.equal(fs.readFileSync(path.join(destinationOriginal, "previo.txt"), "utf8"), "conservar");
});
