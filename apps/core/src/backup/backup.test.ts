// COPIA-COMPLETA-1 · Ida y vuelta de la copia completa entre dos Colonias (DECISIONS.md#d-192): lo que hay en uno
// aparece en el otro, categoría por categoría; las claves viajan cifradas y nunca en claro; una contraseña mala no
// toca nada; y restaurar sobre un Colonia con datos no pierde nada sin dejar antes una copia.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { BackupStatus } from "@colonia/protocol";
import type { FlowGraph } from "@colonia/protocol/flow-graph";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createSecrets } from "../secrets.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { inspectCopy } from "./restore.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const j = (...parts: string[]) => parts.join("");
const PASSWORD = j("contraseña-", "de-la-", "copia-77");
// Valores sembrados: ninguno puede leerse en el archivo de la copia.
const SEEDED = {
  apiKey: j("sk-", "copia-", "Zx81QmN4tYv7Lp2Rk9Wd"),
  providerKey: j("clave-", "proveedor-", "5521-abc"),
  channelToken: j("1234567:", "AAH-canal-copia-xyz"),
  projectVariable: j("variable-", "del-proyecto-", "9914"),
  chat: j("mensaje-", "privado-", "del-chat-4471"),
  memory: j("nota-", "de-memoria-", "8830"),
  agentPrompt: j("instrucciones-", "del-agente-", "2207"),
  projectRules: j("normas-", "del-proyecto-", "6612"),
  channelFile: j("estado-", "del-canal-", "3318"),
};

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "start", kind: "webhook", label: "Webhook" }],
  edges: [],
  layout: [],
};

const SETTINGS = {
  channels: [
    { id: "ch-telegram", type: "telegram", label: "Soporte", enabled: false, agent_id: "superagent" },
    { id: "ch-whatsapp", type: "whatsapp", label: "Ventas", enabled: false, agent_id: "superagent" },
  ],
  navegadores: [
    { id: "nav-trabajo", name: "Trabajo", color: "#2563eb" },
    { id: "nav-personal", name: "Personal", color: "#16a34a" },
  ],
  webapps: [{ id: "app-correo", name: "Correo", url: "https://mail.example.com", navegador: "nav-trabajo" }],
  providers: [
    {
      id: "acme-ia",
      transport: "openai-chat",
      base_url: "https://ia.example.com/v1",
      key: "secret://ACME_IA_KEY",
      models: [],
    },
  ],
  model_router: { chain: ["acme-ia/grande", "fake/fake-1"] },
  appearance: { theme: "dark", accent: "violet" },
};

const LOCAL_TEXT = "mensaje que solo está aquí";
const FINDABLE = [SEEDED.chat, LOCAL_TEXT];

const until = (env: Env): Promise<BackupStatus> =>
  waitFor(
    async () => {
      const s = await env.client.call("backup.status", {});
      return s.state !== "working" && s;
    },
    "que termine la copia",
    { ms: 60_000 },
  );

const start = (home?: string) => startCore({ llm: scriptedLlm(() => say("hecho")), ...(home ? { home } : {}) });

/** Lo que hay en una carpeta de Colonia, por categoría, sin depender de en qué carpeta está. */
function contents(home: string) {
  const db = new DatabaseSync(path.join(home, "colonia.db"), { readOnly: true });
  try {
    const neutral = (text: string) => {
      let out = text;
      for (const variant of [home, home.replaceAll("\\", "/"), home.replaceAll("\\", "\\\\")])
        out = out.replaceAll(variant, "<carpeta>");
      return out;
    };
    const rows = (sql: string) => neutral(JSON.stringify(db.prepare(sql).all()));
    const settings = new Map(
      (
        db.prepare("SELECT key, value FROM meta WHERE key LIKE 'setting:%'").all() as { key: string; value: string }[]
      ).map((r) => [r.key.slice(8), neutral(r.value)]),
    );
    const hits = (text: string) =>
      Number(
        (
          db.prepare("SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?").get(`"${text}"`) as {
            n: number;
          }
        ).n,
      );
    const found = new Map(FINDABLE.map((text) => [text, hits(text)]));
    return {
      projects: rows("SELECT id, name, kind, description FROM projects ORDER BY id"),
      projectPaths: (db.prepare("SELECT id, path FROM projects ORDER BY id").all() as { id: string; path: string }[])
        .filter((p) => p.path)
        .map((p) => ({ id: p.id, path: p.path })),
      chats: rows("SELECT id, kind, project_id, title FROM threads ORDER BY id"),
      messages: rows("SELECT * FROM messages ORDER BY id"),
      flows: rows("SELECT * FROM flows ORDER BY id"),
      agents: rows("SELECT * FROM agents ORDER BY id"),
      memories: rows("SELECT * FROM memories ORDER BY id"),
      found: (text: string) => found.get(text),
      setting: (key: string) => settings.get(key),
    };
  } finally {
    db.close();
  }
}

const count = (text: string) => (JSON.parse(text) as unknown[]).length;

async function seed(a: Env, outside: string) {
  const { project } = await a.client.call("projects.create", {
    name: "Ventas Acme",
    kind: "company",
    description: "Equipo comercial",
  });
  const root = project.path ?? "";
  fs.writeFileSync(path.join(root, "AGENTS.md"), `# Ventas Acme\n\n${SEEDED.projectRules}\n`);
  // Un proyecto cuya carpeta está fuera de la de Colonia.
  fs.mkdirSync(path.join(outside, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(outside, "AGENTS.md"), "# Proyecto de fuera\n\nNormas del proyecto de fuera.\n");
  fs.writeFileSync(path.join(outside, ".apc", "project.json"), JSON.stringify({ name: "De fuera", kind: "team" }));
  fs.writeFileSync(path.join(outside, "trabajo.txt"), "archivo de trabajo que no viaja\n");
  const out = await a.client.call("projects.create", { path: outside });
  await a.client.call("agents.create", {
    project_id: project.id,
    slug: "comercial",
    name: "Comercial",
    role: "Ventas",
    prompt: SEEDED.agentPrompt,
  });
  const chat = await a.client.call("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    project_id: project.id,
    title: "Presupuesto de Acme",
  });
  await a.client.call("threads.send", { thread: chat.id, text: `apunta esto: ${SEEDED.chat}` });
  await a.settle(chat.id);
  await a.client.call("flows.create", { project: project.id, name: "Entrada de clientes", graph });
  await a.client.call("memory.add", { text: SEEDED.memory, scope: "global" });
  await a.client.call("secrets.set", { name: "ACME_IA_KEY", value: SEEDED.providerKey });
  await a.client.call("secrets.set", { name: "OPENAI_API_KEY", value: SEEDED.apiKey });
  await a.client.call("secrets.set", { name: "TELEGRAM_TOKEN", value: SEEDED.channelToken });
  await a.client.call("secrets.set", { name: "FACTURAS_KEY", value: SEEDED.projectVariable, project: project.id });
  for (const [key, value] of Object.entries(SETTINGS)) a.core.store.settings.set(key, JSON.stringify(value));
  // El estado de cada canal en disco: el de Telegram viaja; la sesión de WhatsApp es de aquel equipo.
  for (const id of ["ch-telegram", "ch-whatsapp"]) {
    fs.mkdirSync(path.join(a.home, "channels", id), { recursive: true });
    fs.writeFileSync(
      path.join(a.home, "channels", id, "estado.json"),
      JSON.stringify({ id, marca: SEEDED.channelFile }),
    );
  }
  return { project: project.id, root, chat: chat.id, outside: out.project.id };
}

test("una copia completa lleva todo de un Colonia a otro y nada va en claro", async () => {
  const folder = tempDir("colonia-copia-");
  const tmp = folder.path;
  const outside = path.join(tmp, "proyecto-de-fuera");
  const a = await start();
  let b = await start();
  try {
    const ids = await seed(a, outside);
    const made = await a.client.call("backup.create", { folder: path.join(tmp, "copias"), password: PASSWORD });
    assert.equal(made.state, "working");
    const done = await until(a);
    assert.equal(done.state, "done", `la copia falló: ${done.why}`);
    const file = done.file ?? "";
    assert.ok(file.endsWith(".colonia") && fs.existsSync(file));
    assert.equal(done.bytes, fs.statSync(file).size);
    assert.deepEqual(
      (await a.client.call("backup.list", {})).copies.map((c) => c.file),
      [file],
      "la copia recién creada se lista aunque su carpeta no sea de las habituales",
    );
    await a.core.close();
    const origin = contents(a.home);

    // SECRETOS: nada sembrado se lee en el archivo, ni tal cual ni en base64.
    const raw = fs.readFileSync(file);
    for (const [what, value] of Object.entries({ ...SEEDED, password: PASSWORD, home: a.home })) {
      assert.ok(!raw.includes(Buffer.from(value)), `en claro en la copia: ${what}`);
      assert.ok(!raw.includes(Buffer.from(Buffer.from(value).toString("base64"))), `en base64 en la copia: ${what}`);
    }
    for (const name of ["OPENAI_API_KEY", "colonia.db", "AGENTS.md", "secrets.json"])
      assert.ok(!raw.includes(Buffer.from(name)), `nombre en claro en la copia: ${name}`);

    // CONTRASEÑA MALA: un motivo claro y nada cambia en el equipo de destino.
    const before = contents(b.home);
    assert.deepEqual(await b.client.call("backup.inspect", { file, password: "no-es-la-clave" }), {
      ok: false,
      why: "password",
    });
    await b.client.call("backup.restore", { file, password: "no-es-la-clave", mode: "replace" });
    const refused = await until(b);
    assert.equal(refused.state, "failed");
    assert.equal(refused.why, "password");
    assert.ok(!fs.existsSync(path.join(b.home, ".restaurar", "pendiente.json")), "no queda nada pendiente");
    assert.equal(contents(b.home).chats, before.chats, "nada cambió");
    assert.deepEqual(
      await b.client.call("backup.inspect", { file: path.join(tmp, "no-existe.colonia"), password: PASSWORD }),
      {
        ok: false,
        why: "missing",
      },
    );
    assert.deepEqual(
      await b.client.call("backup.inspect", { file: path.join(a.home, "home-id"), password: PASSWORD }),
      {
        ok: false,
        why: "foreign",
      },
    );

    // RESUMEN: qué trae, antes de restaurar nada.
    const seen = await b.client.call("backup.inspect", { file, password: PASSWORD });
    assert.ok(seen.ok);
    if (!seen.ok) return;
    assert.equal(seen.has_data, false, "un Colonia recién instalado no tiene datos que perder");
    assert.deepEqual(
      {
        projects: seen.summary.projects,
        chats: seen.summary.chats,
        flows: seen.summary.flows,
        channels: seen.summary.channels,
        memories: seen.summary.memories,
        browsers: seen.summary.browsers,
        apps: seen.summary.apps,
        keys: seen.keys,
      },
      {
        projects: count(origin.projects),
        chats: count(origin.chats),
        flows: 1,
        channels: 2,
        memories: 1,
        browsers: 2,
        apps: 1,
        keys: 4,
      },
    );
    assert.ok(seen.summary.messages >= 2 && seen.summary.agents >= 2 && seen.summary.providers >= 1);
    assert.deepEqual(seen.relink, [{ id: "ch-whatsapp", type: "whatsapp", name: "Ventas" }]);

    // El proyecto de fuera no existe en el equipo de destino: se quita para comprobar que vuelve.
    await removeDir(outside);

    const asked = await b.client.call("backup.restore", { file, password: PASSWORD, mode: "replace" });
    assert.equal(asked.state, "working");
    const staged = await until(b);
    assert.equal(staged.state, "done", `la restauración falló: ${staged.why}`);
    assert.equal(staged.restart, "manual");
    // Lo preparado para el reinicio tampoco lleva ninguna clave en claro.
    const waiting = fs
      .readdirSync(path.join(b.home, ".restaurar"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath, e.name));
    assert.ok(waiting.length > 2);
    for (const f of waiting) {
      const bytes = fs.readFileSync(f);
      for (const what of ["apiKey", "providerKey", "channelToken", "projectVariable"] as const)
        assert.ok(!bytes.includes(Buffer.from(SEEDED[what])), `${what} en claro en ${path.basename(f)}`);
    }
    await b.core.close();
    b = await start(b.home);
    const got = contents(b.home);

    // PROYECTOS (y sus carpetas, en la de este equipo).
    assert.equal(got.projects, origin.projects);
    const rootB = got.projectPaths.find((p) => p.id === ids.project)?.path ?? "";
    assert.ok(rootB.startsWith(b.home), `la carpeta del proyecto sigue apuntando al otro equipo: ${rootB}`);
    assert.ok(fs.readFileSync(path.join(rootB, "AGENTS.md"), "utf8").includes(SEEDED.projectRules));
    const listed = (await b.client.call("projects.list", {})).projects;
    assert.ok(listed.some((p) => p.id === ids.project && p.name === "Ventas Acme" && p.kind === "company"));
    // PROYECTO DE FUERA: vuelven sus instrucciones y su configuración; los archivos de trabajo no viajan.
    assert.ok(fs.readFileSync(path.join(outside, "AGENTS.md"), "utf8").includes("Normas del proyecto de fuera"));
    assert.ok(fs.existsSync(path.join(outside, ".apc", "project.json")));
    assert.ok(!fs.existsSync(path.join(outside, "trabajo.txt")));
    // CHATS y sus mensajes, también buscables.
    assert.equal(got.chats, origin.chats);
    assert.equal(got.messages, origin.messages);
    assert.equal(got.found(SEEDED.chat), 1);
    const chat = await b.client.call("threads.get", { thread: ids.chat });
    assert.ok(JSON.stringify(chat.messages).includes(SEEDED.chat));
    // FLOWS.
    assert.equal(got.flows, origin.flows);
    assert.ok(
      (await b.client.call("flows.list", { project: ids.project })).flows.some((f) => f.name === "Entrada de clientes"),
    );
    // AGENTES.
    assert.equal(got.agents, origin.agents);
    assert.ok(
      got.agents.includes(SEEDED.agentPrompt) || fs.existsSync(path.join(rootB, ".apc", "agents", "comercial.md")),
    );
    // CONOCIMIENTO.
    assert.equal(got.memories, origin.memories);
    assert.ok(got.memories.includes(SEEDED.memory));
    // CANALES, NAVEGADORES, APLICACIONES, IAs y AJUSTES: cada uno por separado.
    for (const key of Object.keys(SETTINGS)) assert.equal(got.setting(key), origin.setting(key), `ajuste ${key}`);
    assert.equal(got.setting("model_default"), origin.setting("model_default"));
    // El estado de un canal que se puede llevar viaja; la sesión de WhatsApp no, y se avisa.
    assert.ok(
      fs.readFileSync(path.join(b.home, "channels", "ch-telegram", "estado.json"), "utf8").includes(SEEDED.channelFile),
    );
    assert.ok(!fs.existsSync(path.join(b.home, "channels", "ch-whatsapp")));
    const after = await b.client.call("backup.status", {});
    assert.equal(after.state, "idle");
    assert.deepEqual(after.restored?.relink, [{ id: "ch-whatsapp", type: "whatsapp", name: "Ventas" }]);
    assert.equal(after.restored?.browsers, 3);
    assert.equal(after.restored?.mode, "replace");
    assert.equal(after.restored?.safety, undefined);
    // SECRETOS: están en el almacén de este equipo, con su valor.
    assert.equal((await b.client.call("secrets.reveal", { name: "OPENAI_API_KEY" })).value, SEEDED.apiKey);
    assert.equal((await b.client.call("secrets.reveal", { name: "ACME_IA_KEY" })).value, SEEDED.providerKey);
    assert.equal((await b.client.call("secrets.reveal", { name: "TELEGRAM_TOKEN" })).value, SEEDED.channelToken);
    assert.equal(
      (await b.client.call("secrets.reveal", { name: "FACTURAS_KEY", project: ids.project })).value,
      SEEDED.projectVariable,
    );
    // Lo que es de cada equipo no cambia: su identidad no se copia.
    assert.notEqual(
      fs.readFileSync(path.join(b.home, "home-id"), "utf8"),
      fs.readFileSync(path.join(a.home, "home-id"), "utf8"),
    );
    assert.ok(!fs.existsSync(path.join(b.home, ".restaurar")));

    // El aviso se queda hasta que la persona lo da por visto.
    await b.client.call("backup.dismiss", {});
    assert.equal((await b.client.call("backup.status", {})).restored, undefined);

    // REEMPLAZAR sobre un Colonia con datos: antes se guarda una copia de lo que había.
    const mine = await b.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Solo de aquí",
    });
    await b.client.call("threads.send", { thread: mine.id, text: "esto solo está en este equipo" });
    await b.settle(mine.id);
    const again = await b.client.call("backup.inspect", { file, password: PASSWORD });
    assert.ok(again.ok && again.has_data);
    await b.client.call("backup.restore", { file, password: PASSWORD, mode: "replace" });
    const second = await until(b);
    assert.equal(second.state, "done", `la segunda restauración falló: ${second.why}`);
    await b.core.close();
    b = await start(b.home);
    assert.equal(contents(b.home).chats, origin.chats, "queda exactamente lo de la copia");
    const safety = (await b.client.call("backup.status", {})).restored?.safety ?? "";
    assert.ok(safety.startsWith(path.join(b.home, "copias")) && fs.existsSync(safety));
    const kept = await inspectCopy(safety, PASSWORD);
    assert.equal(kept.summary.chats, count(origin.chats) + 1, "lo que había antes está en la copia de seguridad");
    assert.ok((await b.client.call("backup.list", {})).copies.some((c) => c.file === safety));
  } finally {
    await a.core.close().catch(() => {});
    await b.core.close().catch(() => {});
    await a.cleanup();
    await b.cleanup();
    await folder.remove();
  }
});

test("fusionar una copia añade lo que falta y no cambia lo que ya había", async () => {
  const folder = tempDir("colonia-copia-");
  const tmp = folder.path;
  const outside = path.join(tmp, "proyecto-de-fuera");
  const a = await start();
  let c = await start();
  try {
    const ids = await seed(a, outside);
    await a.client.call("backup.create", { folder: tmp, password: PASSWORD });
    const done = await until(a);
    assert.equal(done.state, "done", `la copia falló: ${done.why}`);
    const file = done.file ?? "";
    await a.core.close();
    const origin = contents(a.home);

    // Lo que ya hay en el equipo de destino.
    const { project: local } = await c.client.call("projects.create", { name: "Proyecto local" });
    const chat = await c.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: local.id,
      title: "Chat local",
    });
    await c.client.call("threads.send", { thread: chat.id, text: LOCAL_TEXT });
    await c.settle(chat.id);
    await c.client.call("memory.add", { text: "nota local de este equipo", scope: "global" });
    await c.client.call("secrets.set", { name: "OPENAI_API_KEY", value: "clave-local-de-este-equipo" });
    c.core.store.settings.set(
      "channels",
      JSON.stringify([{ id: "ch-local", type: "telegram", label: "Local", enabled: false, agent_id: "superagent" }]),
    );
    c.core.store.settings.set("appearance", JSON.stringify({ theme: "light" }));
    c.core.store.settings.set(
      "navegadores",
      JSON.stringify([{ id: "nav-trabajo", name: "Trabajo de aquí", color: "#000000" }]),
    );
    const mine = contents(c.home);

    await c.client.call("backup.restore", { file, password: PASSWORD, mode: "merge" });
    const staged = await until(c);
    assert.equal(staged.state, "done", `la fusión falló: ${staged.why}`);
    await c.core.close();
    c = await start(c.home);
    const got = contents(c.home);

    const ids_ = (text: string) => (JSON.parse(text) as { id: string | number }[]).map((r) => String(r.id));
    // PROYECTOS y CHATS: están los de los dos equipos.
    for (const id of [...ids_(origin.projects), ...ids_(mine.projects)]) assert.ok(ids_(got.projects).includes(id));
    for (const id of [...ids_(origin.chats), ...ids_(mine.chats)]) assert.ok(ids_(got.chats).includes(id));
    assert.equal(count(got.chats), new Set([...ids_(origin.chats), ...ids_(mine.chats)]).size);
    // MENSAJES: ninguno se pierde ni se duplica, y los dos se encuentran al buscar.
    assert.equal(count(got.messages), new Set([...ids_(origin.messages), ...ids_(mine.messages)]).size);
    assert.equal(got.found(SEEDED.chat), 1);
    assert.equal(got.found(LOCAL_TEXT), 1);
    assert.ok(
      JSON.stringify((await c.client.call("threads.get", { thread: ids.chat })).messages).includes(SEEDED.chat),
    );
    assert.ok(
      JSON.stringify((await c.client.call("threads.get", { thread: chat.id })).messages).includes("solo está aquí"),
    );
    // FLOWS y AGENTES de la copia.
    assert.equal(count(got.flows), 1);
    for (const id of ids_(origin.agents)) assert.ok(ids_(got.agents).includes(id));
    // CONOCIMIENTO: las dos notas.
    assert.ok(got.memories.includes(SEEDED.memory) && got.memories.includes("nota local de este equipo"));
    assert.equal(count(got.memories), 2);
    // CANALES: unión; NAVEGADORES: en lo que coincide gana lo de aquí; AJUSTES: lo de aquí no cambia.
    assert.deepEqual((JSON.parse(got.setting("channels") ?? "[]") as { id: string }[]).map((x) => x.id).sort(), [
      "ch-local",
      "ch-telegram",
      "ch-whatsapp",
    ]);
    const browsers = JSON.parse(got.setting("navegadores") ?? "[]") as { id: string; name: string }[];
    assert.deepEqual(browsers.map((x) => `${x.id}=${x.name}`).sort(), [
      "nav-personal=Personal",
      "nav-trabajo=Trabajo de aquí",
    ]);
    assert.equal(JSON.parse(got.setting("appearance") ?? "{}").theme, "light");
    assert.equal(JSON.parse(got.setting("appearance") ?? "{}").accent, "violet");
    assert.equal(got.setting("webapps"), origin.setting("webapps"));
    assert.equal(got.setting("providers"), origin.setting("providers"));
    // SECRETOS: la clave que ya había se queda; las que faltaban llegan.
    assert.equal(
      (await c.client.call("secrets.reveal", { name: "OPENAI_API_KEY" })).value,
      "clave-local-de-este-equipo",
    );
    assert.equal((await c.client.call("secrets.reveal", { name: "ACME_IA_KEY" })).value, SEEDED.providerKey);
    // Y antes de fusionar se guardó una copia de lo que había.
    const status = await c.client.call("backup.status", {});
    assert.equal(status.restored?.mode, "merge");
    const safety = status.restored?.safety ?? "";
    assert.ok(fs.existsSync(safety));
    assert.equal((await inspectCopy(safety, PASSWORD)).summary.chats, count(mine.chats));
    assert.equal(createSecrets(c.home, "file").resolve("secret://TELEGRAM_TOKEN"), SEEDED.channelToken);
  } finally {
    await a.core.close().catch(() => {});
    await c.core.close().catch(() => {});
    await a.cleanup();
    await c.cleanup();
    await folder.remove();
  }
});
