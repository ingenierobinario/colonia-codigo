// PROYECTO-COMPARTIR-1 · Un proyecto se exporta en un Colonia y se importa en otro: llegan sus instrucciones, agentes,
// skills y qué conexiones usa; no llega ni un dato de acceso, ni un chat, ni la memoria, ni la ruta de quien exporta.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PROJECT_FORMAT, packageCode, parsePackage, REMOVED, scrub } from "../domain/project-package.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { sharedProjectRoutes } from "../public-routes.ts";
import { fetchPackage } from "./project-share.ts";

// Datos sembrados: ninguno puede aparecer en lo que sale del Colonia de quien comparte. Se arman por trozos para que
// este fichero no lleve nada con forma de clave real.
const j = (...parts: string[]) => parts.join("");
const SEEDED = {
  apiKey: j("sk-", "proj-", "Zx81QmN4tYv7Lp2Rk9Wd"),
  github: j("ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"),
  password: j("Tr0ub4dor", "&3x"),
  cookie: j("sid=", "s%3Aqwe789asd456.zxc"),
  bearer: j("abc123", "DEF456ghi789"),
  envValue: j("valor-", "secreto-", "del-entorno-42"),
  header: j("cabecera-", "privada-9911"),
  urlUser: j("usuario", ":", "clave8842"),
  variable: j("variable-", "guardada-", "7730"),
  projectVariable: j("variable-", "del-proyecto-", "5519"),
  channel: j("1234567:", "AAH-canal-sesion-xyz"),
  memory: j("nota-", "privada-", "de-memoria-3141"),
  chat: j("mensaje-", "privado-", "del-chat-2718"),
  argToken: j("argumento-", "token-6021"),
  slack: j("xoxb-", "1111-2222-abcdef"),
};

function seedProject(root: string): void {
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  w(
    "AGENTS.md",
    `# Ventas Acme\n\nAtiende a los clientes con tono cercano.\n\nAPI_KEY=${SEEDED.apiKey}\nContraseña: ${SEEDED.password}\nPanel: https://${SEEDED.urlUser}@panel.example.com/entrar\nAuthorization: Bearer ${SEEDED.bearer}\n`,
  );
  w(
    ".apc/agents/ventas.md",
    `---\nname: Ventas\nrole: Comercial\ndescription: Responde a los clientes\n---\nEres el comercial. Usa el token ${SEEDED.github} solo si hace falta.\nCookie: ${SEEDED.cookie}\n`,
  );
  w(
    ".apc/skills/presupuestos/SKILL.md",
    `---\nname: presupuestos\ndescription: Hace presupuestos\n---\nPasos del presupuesto.\nslack: ${SEEDED.slack}\n`,
  );
  w(".apc/skills/presupuestos/plantilla.md", "Plantilla del presupuesto\n");
  w(".apc/skills/presupuestos/.env", `CLAVE=${SEEDED.envValue}\n`);
  w(".apc/skills/presupuestos/cookies.txt", `${SEEDED.cookie}\n`);
  w(".apc/memory.md", `${SEEDED.memory}\n`);
  w(
    ".apc/mcps.json",
    JSON.stringify({
      mcpServers: {
        facturas: {
          command: "npx",
          args: ["-y", "facturas-mcp", "--token", SEEDED.argToken],
          env: { FACTURAS_KEY: SEEDED.envValue },
        },
        crm: {
          url: `https://${SEEDED.urlUser}@crm.example.com/mcp?key=${SEEDED.envValue}`,
          headers: { Authorization: `Bearer ${SEEDED.header}` },
        },
      },
    }),
  );
  w(".apc/organization.json", JSON.stringify({ areas: [{ id: "ventas", name: "Ventas" }], roles: [] }));
}

const boot = () => startCore({ llm: scriptedLlm(() => say(`recibido ${SEEDED.chat}`)) });

test("el paquete exportado no lleva ningún dato de acceso, ni chats, ni memoria, ni la ruta de quien exporta", async () => {
  const a = await boot();
  try {
    const { project } = await a.client.call("projects.create", {
      name: "Ventas Acme",
      kind: "company",
      description: "Equipo comercial",
    });
    const root = project.path ?? "";
    seedProject(root);
    await a.client.call("projects.sync", { project: project.id });
    // Lo que Colonia guarda aparte del proyecto: variables (del dueño y del proyecto), un canal con su sesión, un chat.
    await a.client.call("secrets.set", { name: "FACTURAS_KEY", value: SEEDED.variable });
    await a.client.call("secrets.set", { name: "FACTURAS_KEY", value: SEEDED.projectVariable, project: project.id });
    const chat = await a.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: project.id,
    });
    await a.client.call("threads.send", { thread: chat.id, text: `guarda esto: ${SEEDED.chat} y ${SEEDED.channel}` });
    await a.settle(chat.id);

    const out = await a.client.call("projects.export", { project: project.id });
    const published = await a.client.call("projects.share", { project: project.id, shared: true });
    const served = await sharedProjectRoutes(a.home)(published.path ?? "")?.handle(
      { method: "GET", path: "", headers: {}, body: Buffer.alloc(0) },
      new AbortController().signal,
    );
    const code = parsePackage(out.code);
    assert.ok(code.ok);
    // Las tres salidas: el fichero, el código (ya descomprimido) y lo que responde el enlace publicado.
    const outputs = {
      fichero: out.content,
      codigo: JSON.stringify(code.ok ? code.pkg : {}),
      enlace: String(served?.body),
    };
    for (const [where, text] of Object.entries(outputs)) {
      for (const [what, value] of Object.entries(SEEDED)) assert.ok(!text.includes(value), `${where}: aparece ${what}`);
      assert.ok(!text.includes(root) && !text.includes(a.home), `${where}: aparece la ruta del disco`);
      assert.ok(
        !text.includes("memory.md") && !text.includes("cookies.txt") && !text.includes(".env"),
        `${where}: fichero sensible`,
      );
    }
    assert.ok(out.removed >= 8, `datos quitados: ${out.removed}`);
    assert.equal(out.skipped, 2);

    // Lo que sí viaja.
    const pkg = JSON.parse(out.content);
    assert.equal(pkg.format, PROJECT_FORMAT);
    assert.deepEqual(pkg.project, { name: "Ventas Acme", description: "Equipo comercial", kind: "company" });
    assert.match(pkg.instructions, /Atiende a los clientes con tono cercano/);
    assert.deepEqual(
      pkg.agents.map((x: { slug: string }) => x.slug),
      ["ventas"],
    );
    assert.match(pkg.agents[0].text, /Eres el comercial/);
    assert.deepEqual(
      pkg.skills[0].files.map((f: { path: string }) => f.path),
      ["SKILL.md", "plantilla.md"],
    );
    assert.deepEqual(pkg.connections, [
      {
        name: "facturas",
        command: "npx",
        args: ["-y", "facturas-mcp", "--token", REMOVED],
        needs: ["FACTURAS_KEY"],
        headers: [],
      },
      { name: "crm", args: [], url: "https://crm.example.com/mcp", needs: [], headers: ["Authorization"] },
    ]);
    assert.equal(out.agents, 1);
    assert.equal(out.skills, 1);
    assert.equal(out.connections, 2);
  } finally {
    await a.core.close();
    await a.cleanup();
  }
});

test("exportar → importar en otro Colonia: mismo proyecto, y las conexiones quedan pendientes de conectar", async () => {
  const a = await boot();
  const b = await boot();
  try {
    const { project } = await a.client.call("projects.create", { name: "Ventas Acme", kind: "company" });
    seedProject(project.path ?? "");
    const out = await a.client.call("projects.export", { project: project.id });

    // Mirada previa: no escribe nada.
    const seen = await b.client.call("projects.import", { content: out.content, save: false, replace: false });
    assert.equal(seen.saved, false);
    assert.equal(seen.taken, false);
    assert.deepEqual(
      [seen.name, seen.agents, seen.skills, seen.connections, seen.organization],
      ["Ventas Acme", 1, 1, 2, true],
    );
    assert.equal((await b.client.call("projects.list", {})).projects.filter((p) => p.name === "Ventas Acme").length, 0);

    const got = await b.client.call("projects.import", { content: out.content, save: true, replace: false });
    assert.equal(got.saved, true);
    assert.deepEqual(got.pending, [
      { name: "facturas", needs: ["FACTURAS_KEY"], remote: false },
      { name: "crm", needs: ["Authorization"], remote: true },
    ]);
    const root = got.project?.path ?? "";
    assert.ok(root.startsWith(path.join(fs.realpathSync(b.home), "projects")) || root.includes("projects"));
    assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Atiende a los clientes/);
    assert.match(fs.readFileSync(path.join(root, ".apc", "agents", "ventas.md"), "utf8"), /Eres el comercial/);
    assert.ok(fs.existsSync(path.join(root, ".apc", "skills", "presupuestos", "plantilla.md")));
    assert.ok(!fs.existsSync(path.join(root, ".apc", "memory.md")));
    const mcps = JSON.parse(fs.readFileSync(path.join(root, ".apc", "mcps.json"), "utf8"));
    assert.deepEqual(mcps.mcpServers.facturas.env, { FACTURAS_KEY: "" });
    assert.deepEqual(mcps.mcpServers.crm, { url: "https://crm.example.com/mcp", headers: { Authorization: "" } });
    assert.equal(got.project?.kind, "company");
    const agents = await b.client.call("agents.list", {});
    assert.ok(agents.agents.some((x) => x.name === "Ventas"));
    const skills = await b.client.call("skills.list", { project: got.project?.id ?? "" });
    assert.ok(skills.skills.some((s) => s.name === "presupuestos"));

    // Nombre repetido: se avisa; con «Reemplazar» se sobrescribe lo del mismo nombre y lo demás se queda.
    fs.writeFileSync(path.join(root, "notas-propias.md"), "mías\n");
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# cambiado\n");
    assert.equal(
      (await b.client.call("projects.import", { content: out.content, save: false, replace: false })).taken,
      true,
    );
    await assert.rejects(
      b.client.call("projects.import", { content: out.content, save: true, replace: false }),
      /already a project named Ventas Acme/,
    );
    const again = await b.client.call("projects.import", { content: out.content, save: true, replace: true });
    assert.equal(again.project?.id, got.project?.id);
    assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Atiende a los clientes/);
    assert.equal(fs.readFileSync(path.join(root, "notas-propias.md"), "utf8"), "mías\n");
    // CLAVES-PROPIAS-1 · Reemplazar no vacía los datos que la persona ya puso en una conexión que sigue igual, y esa
    // conexión deja de salir como pendiente; si el servidor de la conexión cambió, sus datos entran vacíos.
    const ownFile = path.join(root, ".apc/mcps.json");
    const mine = JSON.parse(fs.readFileSync(ownFile, "utf8"));
    mine.mcpServers.facturas.env.FACTURAS_KEY = "clave-propia-de-b";
    mine.mcpServers.crm.headers.Authorization = "cabecera-propia-de-b";
    mine.mcpServers.crm.url = "https://otro-servidor.example.com/mcp";
    fs.writeFileSync(ownFile, JSON.stringify(mine));
    const third = await b.client.call("projects.import", { content: out.content, save: true, replace: true });
    const after = JSON.parse(fs.readFileSync(ownFile, "utf8"));
    assert.equal(after.mcpServers.facturas.env.FACTURAS_KEY, "clave-propia-de-b");
    assert.equal(after.mcpServers.crm.url, "https://crm.example.com/mcp");
    assert.equal(after.mcpServers.crm.headers.Authorization, "");
    assert.deepEqual(
      third.pending.map((c) => c.name),
      ["crm"],
    );
    // O con otro nombre: un proyecto aparte.
    const other = await b.client.call("projects.import", {
      content: out.code,
      name: "Ventas Acme 2",
      save: true,
      replace: false,
    });
    assert.notEqual(other.project?.id, got.project?.id);
    assert.equal(other.project?.name, "Ventas Acme 2");
  } finally {
    await a.core.close();
    await a.cleanup();
    await b.core.close();
    await b.cleanup();
  }
});

test("se rechaza con un motivo claro lo que no es un proyecto de Colonia, lo dañado y lo de una versión posterior", async () => {
  const b = await boot();
  try {
    const bring = (content: string) => b.client.call("projects.import", { content, save: true, replace: false });
    await assert.rejects(bring("hola, esto es un texto cualquiera"), /not a Colonia project/);
    await assert.rejects(bring(JSON.stringify({ name: "otro programa", version: 3 })), /not a Colonia project/);
    await assert.rejects(bring("---\ncolonia: colonia-1\nname: receta\n---\n1. paso"), /not a Colonia project/);
    await assert.rejects(
      bring(JSON.stringify({ format: "colonia-proyecto-2", project: { name: "x" } })),
      /newer Colonia/,
    );
    await assert.rejects(bring("colonia-proyecto-7:AAAA"), /newer Colonia/);
    await assert.rejects(bring("colonia-proyecto-1:AAAA"), /damaged/);
    await assert.rejects(bring(JSON.stringify({ format: PROJECT_FORMAT, project: { name: "x" } })), /damaged/);
    // Un paquete que intenta escribir fuera de la carpeta del proyecto no pasa la validación.
    const base = {
      format: PROJECT_FORMAT,
      exported_at: "2026-01-01T00:00:00.000Z",
      project: { name: "Trampa" },
      instructions: "",
      agents: [],
      connections: [],
    };
    for (const p of ["../../fuera.md", "/etc/x", "a/../../b", ".git/config", "a\\b"])
      await assert.rejects(
        bring(JSON.stringify({ ...base, skills: [{ folder: "s", files: [{ path: p, text: "x" }] }] })),
        /damaged/,
        p,
      );
    await assert.rejects(
      bring(JSON.stringify({ ...base, skills: [], agents: [{ slug: "../x", text: "" }] })),
      /damaged/,
    );
    await assert.rejects(bring(JSON.stringify({ ...base, skills: [], extra: 1 })), /damaged/);
    assert.equal((await b.client.call("projects.list", {})).projects.filter((p) => p.name === "Trampa").length, 0);
  } finally {
    await b.core.close();
    await b.cleanup();
  }
});

test("publicar da un enlace que responde con el paquete; publicar otra vez lo renueva y dejar de publicar lo apaga", async () => {
  const a = await boot();
  const b = await boot();
  try {
    const { project } = await a.client.call("projects.create", { name: "Soporte" });
    const root = project.path ?? "";
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Soporte\n\nPrimera versión.\n");
    const routes = sharedProjectRoutes(a.home);
    const get = async (p: string, method = "GET") =>
      routes(p)?.handle({ method, path: "", headers: {}, body: Buffer.alloc(0) }, new AbortController().signal);

    assert.equal((await a.client.call("projects.export", { project: project.id })).path, undefined);
    const one = await a.client.call("projects.share", { project: project.id, shared: true });
    assert.match(one.path ?? "", /^\/p\/[a-f0-9]{32}$/);
    assert.equal((await a.client.call("projects.export", { project: project.id })).path, one.path);
    const first = await get(one.path ?? "");
    assert.equal(first?.status, 200);
    assert.match(String(first?.body), /Primera versión/);
    assert.equal((await get(one.path ?? "", "HEAD"))?.body, undefined);
    // La copia es de cuando se publicó: un cambio posterior no sale hasta publicar otra vez, con el mismo enlace.
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Soporte\n\nSegunda versión.\n");
    assert.match(String((await get(one.path ?? ""))?.body), /Primera versión/);
    const two = await a.client.call("projects.share", { project: project.id, shared: true });
    assert.equal(two.path, one.path);
    assert.match(String((await get(one.path ?? ""))?.body), /Segunda versión/);
    // Solo responde lo publicado.
    assert.equal(routes("/p/00000000000000000000000000000000"), undefined);
    assert.equal(routes(`${one.path}/x`), undefined);
    assert.equal(routes("/p/index"), undefined);

    // El otro Colonia lo importa desde el enlace: solo https y solo /p/<enlace>.
    const body = String((await get(one.path ?? ""))?.body);
    const asked: string[] = [];
    const fake = async (url: string) => {
      asked.push(url);
      return new Response(body, { status: 200 });
    };
    const text = await fetchPackage(`https://colonia.example.com${one.path}?x=1#y`, fake);
    assert.deepEqual(asked, [`https://colonia.example.com${one.path}`]);
    const got = await b.client.call("projects.import", { content: text, save: true, replace: false });
    assert.match(fs.readFileSync(path.join(got.project?.path ?? "", "AGENTS.md"), "utf8"), /Segunda versión/);
    for (const bad of [
      `http://colonia.example.com${one.path}`,
      "https://colonia.example.com/rpc/x",
      `https://u:p@colonia.example.com${one.path}`,
      "nada",
    ])
      await assert.rejects(fetchPackage(bad, fake), /not a Colonia project link/, bad);
    assert.equal(asked.length, 1);
    await assert.rejects(
      fetchPackage(`https://colonia.example.com${one.path}`, async () => new Response("", { status: 302 })),
      /no longer be published/,
    );
    await assert.rejects(
      b.client.call("projects.import", { link: "https://colonia.example.com/otra", save: false, replace: false }),
      /not a Colonia project link/,
    );

    assert.deepEqual(await a.client.call("projects.share", { project: project.id, shared: false }), { shared: false });
    assert.equal(routes(one.path ?? ""), undefined);
    assert.equal((await a.client.call("projects.export", { project: project.id })).path, undefined);
  } finally {
    await a.core.close();
    await a.cleanup();
    await b.core.close();
    await b.cleanup();
  }
});

test("el texto de instrucciones conserva lo que no es un dato de acceso", () => {
  const keep = [
    "Usa la variable FACTURAS_KEY (secret://FACTURAS_KEY) para entrar.",
    j("token: $", "{TOKEN}"),
    "password: <tu contraseña>",
    "Pide la clave al cliente antes de seguir.",
    "Consulta https://docs.example.com/guia?page=2 y responde en menos de 24 horas.",
    "El pedido 2024-00017 va a la calle Mayor 12.",
  ].join("\n");
  assert.deepEqual(scrub(keep), { text: keep, removed: 0 });
  const dirty = scrub(
    `password = "${SEEDED.password}"\n-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\nver https://x.example.com/a?token=${SEEDED.bearer}&page=2`,
  );
  assert.equal(dirty.text, `password = ${REMOVED}\n${REMOVED}\nver https://x.example.com/a?token=${REMOVED}&page=2`);
  assert.equal(dirty.removed, 3);
  // SECRETO-ANIDADO-1 · Una clave sin valor en su línea («auth:») no se come la clave de la línea siguiente: se quita
  // el dato, no su nombre. Y el valor que sí va solo en la línea siguiente se sigue quitando.
  const nested = scrub(`auth:\n  client_secret: ${SEEDED.envValue}\ncredentials:\n  password = ${SEEDED.password}\n`);
  assert.equal(nested.text, `auth:\n  client_secret: ${REMOVED}\ncredentials:\n  password = ${REMOVED}\n`);
  assert.equal(scrub(`token:\n  ${SEEDED.envValue}\n`).text, `token:\n  ${REMOVED}\n`);
  // El código es el mismo paquete en una línea.
  const pkg = {
    format: PROJECT_FORMAT,
    exported_at: "2026-01-01T00:00:00.000Z",
    project: { name: "Uno" },
    instructions: "hola",
    agents: [],
    skills: [],
    connections: [],
  } as const;
  const back = parsePackage(`  ${packageCode({ ...pkg, agents: [], skills: [], connections: [] })}\n`);
  assert.ok(back.ok && back.pkg.instructions === "hola");
});
