import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { readArchive } from "./archive.ts";

async function until(env: Awaited<ReturnType<typeof startCore>>) {
  return waitFor(
    async () => {
      const status = await env.client.call("backup.status", {});
      return status.state !== "working" && status;
    },
    "la copia privada del proyecto",
    { ms: 60000 },
  );
}

function seedRelations(home: string, project: string, neighbor: string, thread: string) {
  const db = new DatabaseSync(path.join(home, "colonia.db"));
  const at = new Date().toISOString();
  const insert = (table: string, row: Record<string, SQLInputValue>) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
      ...Object.values(row),
    );
  };
  const mediaBytes = Buffer.alloc(350_123, 39);
  try {
    db.exec("BEGIN");
    for (const [id, slug, project_id, parent] of [
      ["ag_ficha", "ficha", project, null],
      ["ag_hijo", "hijo", null, "ag_ficha"],
      ["ag_fuera", "ajeno", neighbor, null],
    ] as const) {
      insert("agents", {
        id,
        name: slug,
        slug,
        kind: "worker",
        project_id,
        parent,
        extra: JSON.stringify({ area: "ventas", skills: ["analisis"] }),
        created_at: at,
      });
    }
    for (const [id, title, project_id] of [
      ["th_hijo", "Hilo secundario", null],
      ["th_fuera", "Conversación del vecino", neighbor],
    ] as const) {
      insert("threads", {
        id,
        kind: "loose",
        title,
        project_id,
        parent_id: thread,
        agent_ids: JSON.stringify(["ag_hijo"]),
        created_at: at,
        updated_at: at,
      });
    }
    const mediaDir = path.join(home, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    for (const [id, thread_id, data] of [
      ["med_ficha", "th_hijo", mediaBytes],
      ["med_fuera", "th_fuera", Buffer.from("bytes-privados-del-vecino")],
      ["med_compartido", null, Buffer.from("bytes-compartidos-con-vecino")],
    ] as const) {
      const file = path.join(mediaDir, `${id}.bin`);
      fs.writeFileSync(file, data);
      insert("media", {
        id,
        kind: "file",
        mime: "application/octet-stream",
        bytes: data.length,
        path: file,
        thread_id,
        created_at: at,
      });
    }
    const attachment = (id: string) => ({
      type: "file",
      media_id: id,
      name: "ficha.bin",
      mime: "application/octet-stream",
      bytes: mediaBytes.length,
    });
    insert("messages", {
      id: "msg_ficha",
      thread_id: "th_hijo",
      seq: 1,
      author: '{"kind":"agent","id":"ag_hijo"}',
      parts: JSON.stringify([
        { type: "text", text: "croquisazul" },
        attachment("med_ficha"),
        attachment("med_fuera"),
        attachment("med_compartido"),
      ]),
      created_at: at,
    });
    insert("messages", {
      id: "msg_vecino",
      thread_id: "th_fuera",
      seq: 1,
      author: '{"kind":"user"}',
      parts: JSON.stringify([{ type: "text", text: "mensaje-privado-del-vecino" }, attachment("med_compartido")]),
      created_at: at,
    });
    insert("tasks", {
      id: "task_propia",
      title: "Revisar el croquis",
      status: "open",
      thread_id: "th_hijo",
      project_id: project,
      assignee: "ag_ficha",
      created_by: "owner",
      created_at: at,
      updated_at: at,
      activity_at: at,
    });
    insert("task_events", { task_id: "task_propia", at, op: "comment", by: "ag_ficha", data: "{}" });
    insert("task_attachments", {
      task_id: "task_propia",
      media_id: "med_ficha",
      source_media_id: "med_ficha",
      source_thread_id: "th_hijo",
      created_by: "owner",
    });
    insert("memories", {
      id: "mem_ficha",
      scope: "project",
      project_id: project,
      text: "Recuerdo del plano",
      source: "user",
      created_at: at,
      updated_at: at,
      thread_id: "th_hijo",
    });
    insert("surfaces", {
      id: "sf_ficha",
      name: "cuadro",
      title: "Cuadro propio",
      html: "<main>Ficha</main>",
      version: 1,
      project_id: project,
      thread_id: "th_hijo",
      created_by: "ag_ficha",
      updated_at: at,
      share_token: "permiso-antiguo-del-cuadro",
    });
    insert("routines", {
      id: "rt_ficha",
      name: "Leer el croquis",
      project_id: project,
      agent_id: "superagent",
      schedule: '{"kind":"manual"}',
      prompt: "Lee el croquis",
      enabled: 0,
      created_at: at,
      updated_at: at,
    });
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return mediaBytes;
}

test("la copia privada de un proyecto excluye al vecino y se fusiona con identidades y carpeta nuevas", async () => {
  const tmp = tempDir("colonia-copia-proyecto-");
  const source = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const target = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const password = "contraseña guardada en la prueba";
  try {
    const a = (await source.client.call("projects.create", { name: "Diseño" })).project;
    const b = (await source.client.call("projects.create", { name: "Vecino secreto ejemplo" })).project;
    assert.ok(a.path && b.path);
    const bytes = Buffer.alloc(280_000, 47);
    fs.writeFileSync(path.join(a.path, "cuaderno.dat"), bytes);
    fs.writeFileSync(path.join(b.path, "solo-del-vecino.txt"), "dato-ajeno-441");
    const chat = await source.client.call("threads.create", {
      project_id: a.id,
      kind: "loose",
      title: "Conversación propia",
      agent_id: "superagent",
    });
    const mediaBytes = seedRelations(source.home, a.id, b.id, chat.id);
    await source.client.call("secrets.set", { name: "SOLO_UNA_PRUEBA", value: "clave-global-de-prueba-821" });
    await source.client.call("flows.create", {
      project: a.id,
      name: "Flujo privado",
      graph: { schemaVersion: 2, nodes: [{ id: "inicio", kind: "webhook", label: "Inicio" }], edges: [], layout: [] },
    });
    fs.writeFileSync(
      path.join(a.path, ".apc", "mcps.json"),
      JSON.stringify({
        mcpServers: {
          agenda: {
            url: "https://example.invalid/agenda",
            headers: { "X-Api-Key": "clave-del-conector-de-prueba-799" },
          },
        },
      }),
    );
    await source.client.call("backup.create", { project_id: a.id, folder: tmp.path, password });
    await until(source);
    const made = await source.client.call("backup.status", {});
    assert.equal(made.state, "done");
    assert.ok(made.file);
    const entries: string[] = [];
    const material: Buffer[] = [];
    await readArchive(made.file, password, (entry) => {
      entries.push(entry.p);
      return {
        write(bytes) {
          material.push(Buffer.from(bytes));
        },
        end() {},
      };
    });
    assert.ok(entries.includes("manifest.json"));
    assert.ok(!entries.includes("colonia.db") && !entries.includes("secrets.json"));
    assert.ok(!Buffer.concat(material).includes(Buffer.from("dato-ajeno-441")));
    const clear = Buffer.concat(material);
    for (const forbidden of [
      b.name,
      b.id,
      "ag_fuera",
      "med_fuera",
      "med_compartido",
      "bytes-privados-del-vecino",
      "bytes-compartidos-con-vecino",
      "mensaje-privado-del-vecino",
      "permiso-antiguo-del-cuadro",
      "clave-global-de-prueba-821",
      "clave-del-conector-de-prueba-799",
    ])
      assert.ok(!clear.includes(Buffer.from(forbidden)), forbidden);
    assert.ok(entries.includes("media/med_ficha"));
    assert.ok(entries.includes("files/.apc/mcps.json"));
    const seen = await target.client.call("backup.inspect", { file: made.file, password });
    assert.ok(seen.ok);
    assert.equal(seen.scope?.project_id, a.id);
    assert.equal(seen.summary.projects, 1);
    assert.equal(seen.summary.chats, 2);
    assert.equal(seen.summary.agents, 2);
    assert.equal(seen.summary.messages, 1);
    assert.equal(seen.summary.flows, 1);
    assert.equal(seen.summary.memories, 1);
    assert.equal(seen.summary.routines, 1);
    assert.equal(seen.keys, 0);
    await target.client.call("backup.restore", { file: made.file, password, mode: "replace" });
    await until(target);
    assert.equal((await target.client.call("backup.status", {})).state, "failed");
    const existing = (await target.client.call("projects.create", { name: "Diseño" })).project;
    assert.ok(existing.path);
    fs.writeFileSync(path.join(existing.path, "cuaderno.dat"), "destino intacto");
    const collision = new DatabaseSync(path.join(target.home, "colonia.db"));
    try {
      collision
        .prepare(
          "INSERT INTO agents(id,name,kind,created_at,project_id) VALUES('ag_ficha','Original del destino','worker',?,?)",
        )
        .run(new Date().toISOString(), existing.id);
    } finally {
      collision.close();
    }
    await target.client.call("backup.restore", {
      file: made.file,
      password,
      mode: "merge",
      destination: existing.path,
    });
    assert.equal((await until(target)).why, "folder");
    await target.client.call("backup.restore", { file: made.file, password, mode: "merge" });
    await until(target);
    const restored = await target.client.call("backup.status", {});
    assert.equal(restored.state, "done", restored.why);
    const copy = restored.imported_project;
    assert.ok(copy);
    assert.notEqual(copy.id, existing.id);
    assert.notEqual(copy.id, a.id);
    assert.deepEqual(fs.readFileSync(path.join(copy.path, "cuaderno.dat")), bytes);
    assert.equal(fs.readFileSync(path.join(existing.path, "cuaderno.dat"), "utf8"), "destino intacto");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(copy.path, ".apc", "mcps.json"), "utf8")).mcpServers.agenda.headers,
      { "X-Api-Key": "" },
    );
    const db = new DatabaseSync(path.join(target.home, "colonia.db"), { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT count(*) AS n FROM projects WHERE name=?").get(b.name)?.n, 0);
      assert.equal(
        db.prepare("SELECT title FROM threads WHERE project_id=? AND parent_id IS NULL").get(copy.id)?.title,
        "Conversación propia",
      );
      const main = db.prepare("SELECT * FROM threads WHERE project_id=? AND parent_id IS NULL").get(copy.id);
      const child = db.prepare("SELECT * FROM threads WHERE project_id=? AND parent_id=?").get(copy.id, main?.id ?? "");
      assert.deepEqual(JSON.parse(String(main?.agent_ids)), ["superagent"]);
      assert.ok(child && child.id !== "th_hijo");
      const agent = db.prepare("SELECT * FROM agents WHERE project_id=? AND slug='hijo'").get(copy.id);
      const head = db.prepare("SELECT * FROM agents WHERE project_id=? AND slug='ficha'").get(copy.id);
      assert.ok(head && agent && head.id !== "ag_ficha" && agent.parent === head.id);
      assert.equal(db.prepare("SELECT name FROM agents WHERE id='ag_ficha'").get()?.name, "Original del destino");
      const msg = db.prepare("SELECT * FROM messages WHERE thread_id=?").get(String(child.id));
      assert.equal(JSON.parse(String(msg?.author)).id, agent.id);
      const parts = JSON.parse(String(msg?.parts));
      assert.equal(parts.length, 2);
      const media = db.prepare("SELECT * FROM media WHERE id=?").get(parts[1].media_id);
      assert.equal(media?.thread_id, child.id);
      assert.deepEqual(fs.readFileSync(String(media?.path)), mediaBytes);
      const task = db.prepare("SELECT * FROM tasks WHERE project_id=?").get(copy.id);
      assert.ok(task && task.thread_id === child.id && task.assignee === head.id);
      const attachment = db.prepare("SELECT * FROM task_attachments WHERE task_id=?").get(String(task.id));
      assert.equal(attachment?.media_id, media?.id);
      assert.equal(attachment?.source_thread_id, child.id);
      assert.equal(db.prepare("SELECT by FROM task_events WHERE task_id=?").get(String(task.id))?.by, head.id);
      assert.equal(db.prepare("SELECT share_token FROM surfaces WHERE project_id=?").get(copy.id)?.share_token, null);
      assert.equal(db.prepare("SELECT enabled FROM routines WHERE project_id=?").get(copy.id)?.enabled, 0);
      assert.equal(
        db.prepare("SELECT enabled FROM flows WHERE project_id=? AND name=?").get(copy.id, "Flujo privado")?.enabled,
        0,
      );
      assert.equal(db.prepare("SELECT text FROM memories WHERE project_id=?").get(copy.id)?.text, "Recuerdo del plano");
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH 'croquisazul'").get()?.n,
        1,
      );
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      db.close();
    }
  } finally {
    await source.core.close();
    await target.core.close();
    await source.cleanup();
    await target.cleanup();
    await tmp.remove();
  }
});
