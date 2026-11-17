// PROYECTO-COMPARTIR-1 · Un proyecto se exporta en un Colonia y se importa en otro: llegan sus instrucciones, agentes,
// skills y qué conexiones usa; no llega ni un dato de acceso, ni un chat, ni la memoria, ni la ruta de quien exporta.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { connectionOf, PROJECT_FORMAT, packageCode, parsePackage, REMOVED, scrub } from "../domain/project-package.ts";
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

    // ENLACE-TEMPORAL-2 · Con otro proyecto publicado, retirar éste deja el otro en pie y lo dice (`left`).
    const { project: other } = await a.client.call("projects.create", { name: "Ventas" });
    const otherLink = await a.client.call("projects.share", { project: other.id, shared: true });
    assert.deepEqual(await a.client.call("projects.share", { project: project.id, shared: false }), {
      shared: false,
      left: 1,
    });
    assert.equal((await get(otherLink.path ?? ""))?.status, 200);
    assert.deepEqual(await a.client.call("projects.share", { project: other.id, shared: false }), {
      shared: false,
      left: 0,
    });
    assert.equal(routes(one.path ?? ""), undefined);
    assert.equal((await a.client.call("projects.export", { project: project.id })).path, undefined);
  } finally {
    await a.core.close();
    await a.cleanup();
    await b.core.close();
    await b.cleanup();
  }
});

test("TEXTO-LIBRE-1 · una clave escrita en texto libre, en un argumento o en una dirección no sale", () => {
  // Datos inventados con la forma de los reales, partidos para que ningún escáner de secretos los tome por buenos.
  const random = j("a8Kq2ZxP0vLm", "7RtY3wNs9BdF", "5hJc1GeU");
  const cases: Array<[string, string]> = [
    ["la clave es X", j("Entra con el usuario ana. La clave es ", "Tr0ub4dor-2024", ".")],
    ["token X", j("Usa el token ", "zx81-ALFA-99-beta", " para llamar al servicio.")],
    ["password is X", j("The password is ", "hunter2-Winter", " for now.")],
    ["sk-", j("sk", "-proj-", random)],
    ["sk-ant-", j("sk", "-ant-api03-", random)],
    ["xoxb-", j("xo", "xb-123456789012-", "abcdefABCDEF123456")],
    ["xoxp-", j("xo", "xp-123456789012-", "abcdefABCDEF123456")],
    ["ghp_", j("gh", "p_", random)],
    ["github_pat_", j("github", "_pat_", random)],
    ["AIza", j("AI", "za", random, "abc")],
    ["bot de Discord", j("MTIzNDU2Nzg5MDEyMzQ1Njc4", ".GaBcDe.", random)],
    ["bot de Telegram", j("1234567890", ":AAF", random)],
    ["JWT", j("ey", "JhbGciOiJIUzI1NiJ9", ".eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV")],
    ["Bearer", j("Cabecera Bearer ", "abc123def456ghi789")],
    ["usuario y contraseña en una dirección", j("postgres://ana", ":Sup3rSecreta", "@db.example.com/ventas")],
    ["?token=", j("https://api.example.com/v1?token", "=abc123def456", "&x=1")],
    ["&secret=", j("https://api.example.com/v1?x=1&client_secret", "=abc123def456")],
    ["?key=", j("https://api.example.com/v1?key", "=abc123def456")],
    ["cadena larga", random],
    ["base64", j("Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFla", "+/8=")],
  ];
  for (const [what, text] of cases) {
    const out = scrub(`Antes. ${text}\nDespués.`);
    assert.ok(out.removed >= 1, `${what}: no se ha quitado nada`);
    assert.ok(out.text.startsWith("Antes. ") && out.text.endsWith("\nDespués."), `${what}: se ha comido el contexto`);
    for (const piece of text
      .split(/[\s?&=@:/]+/)
      .filter((p) => p.length >= 12 && /[0-9]/.test(p) && !p.includes(".example.")))
      assert.ok(!out.text.includes(piece), `${what}: sigue «${piece}» en «${out.text}»`);
  }
  // Lo mismo dentro del paquete: descripción del agente, argumento suelto y tramo de la dirección de una conexión.
  const arg = connectionOf("uno", {
    command: "npx",
    args: ["-y", "srv", random, "claude-3-5-sonnet-20241022", "--port", "8080"],
  });
  assert.deepEqual(arg?.connection.args, ["-y", "srv", REMOVED, "claude-3-5-sonnet-20241022", "--port", "8080"]);
  assert.equal(arg?.removed, 1);
  const inPath = connectionOf("dos", { url: `https://mcp.example.com/v1/${random}/sse` });
  assert.equal(inPath?.removed, 1);
  assert.ok(!inPath?.connection.url?.includes(random));
  assert.match(inPath?.connection.url ?? "", /^https:\/\/mcp\.example\.com\/v1\/.+\/sse$/);
  assert.equal(
    connectionOf("tres", { url: "https://mcp.example.com/v1/sse" })?.connection.url,
    "https://mcp.example.com/v1/sse",
  );
});

test("AVISO-QUITADOS-1 · exportar dice en qué parte del proyecto se quitó cada dato, sin el dato", async () => {
  const a = await boot();
  try {
    const { project } = await a.client.call("projects.create", { name: "Avisos", kind: "company" });
    const root = project.path ?? "";
    const secret = j("zx81-ALFA-", "99-beta");
    const random = j("a8Kq2ZxP0vLm", "7RtY3wNs9BdF", "5hJc1GeU");
    const put = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    put("AGENTS.md", `# Avisos\n\nLa clave es ${secret}.\n`);
    put(".apc/agents/uno.md", `---\nname: Uno\nrole: R\ndescription: usa el token ${secret} siempre\n---\nCuerpo.\n`);
    put(
      ".apc/mcps.json",
      JSON.stringify({
        mcpServers: {
          suelto: { command: "npx", args: ["-y", "srv", random] },
          ruta: { url: `https://mcp.example.com/${random}/sse` },
          limpio: { command: "npx", args: ["-y", "srv"] },
        },
      }),
    );
    await a.client.call("projects.sync", { project: project.id });
    const out = await a.client.call("projects.export", { project: project.id });
    assert.ok(!out.content.includes(secret) && !out.content.includes(random), out.content);
    assert.deepEqual(
      [...out.removed_in].sort((x, y) => `${x.kind}${x.name}`.localeCompare(`${y.kind}${y.name}`)),
      [
        { kind: "agent", name: "uno", count: 1 },
        { kind: "connection", name: "ruta", count: 1 },
        { kind: "connection", name: "suelto", count: 1 },
        { kind: "instructions", name: "", count: 1 },
      ],
    );
    assert.equal(out.removed, 4);
    assert.ok(!JSON.stringify(out.removed_in).includes(secret));
  } finally {
    await a.core.close();
    await a.cleanup();
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
    "La clave es importante: el token de acceso lo da el cliente y la contraseña se cambia cada 90 días.",
    "El modelo es claude-3-5-sonnet-20241022 y el token máximo son 4096.",
    "Mira apps/core/src/domain/ProjectPackage2/readPackageFromDisk/index y packages/protocol/src/AppMethods.ts.",
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

test("SKILLS-AUTOCONTENIDO-1 · exportar lleva las skills del proyecto y las globales que usan sus agentes; importar no pisa las que ya hay", async () => {
  const a = await boot();
  const b = await boot();
  const w = (root: string, rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  try {
    const { project } = await a.client.call("projects.create", { name: "Ventas Acme", kind: "company" });
    const root = project.path ?? "";
    seedProject(root);
    w(root, ".apc/agents/tarifas.md", "---\nname: Tarifas\nskills: tarifas-acme\n---\nCalcula tarifas.\n");
    w(root, ".claude/skills/guia-local/SKILL.md", "---\nname: guia-local\ndescription: Guía\n---\nLocal.\n");
    w(a.home, "skills/tarifas-acme/SKILL.md", "---\nname: tarifas-acme\ndescription: Tarifas\n---\nDe A.\n");
    w(a.home, "skills/tarifas-acme/tabla.md", "tabla\n");
    w(a.home, "skills/sin-usar/SKILL.md", "---\nname: sin-usar\ndescription: Nadie la usa\n---\nNo.\n");
    const out = await a.client.call("projects.export", { project: project.id });
    const pkg = JSON.parse(out.content) as { skills: { folder: string; files: { path: string }[] }[] };
    assert.deepEqual(pkg.skills.map((s) => s.folder).sort(), ["guia-local", "presupuestos", "tarifas-acme"]);
    assert.ok(pkg.skills.find((s) => s.folder === "tarifas-acme")?.files.some((f) => f.path === "tabla.md"));

    // En B ya hay una «tarifas-acme» distinta: no se pisa y se declara.
    w(b.home, "skills/tarifas-acme/SKILL.md", "---\nname: tarifas-acme\ndescription: La de B\n---\nDe B.\n");
    const got = await b.client.call("projects.import", { content: out.content, save: true, replace: false });
    assert.deepEqual(got.skill_conflicts, [{ name: "tarifas-acme", reason: "different" }]);
    assert.match(fs.readFileSync(path.join(b.home, "skills/tarifas-acme/SKILL.md"), "utf8"), /De B\./);
    const dest = got.project?.path ?? "";
    assert.ok(!fs.existsSync(path.join(dest, ".apc/skills/tarifas-acme")));
    assert.ok(fs.existsSync(path.join(dest, ".apc/skills/guia-local/SKILL.md")));
    assert.ok(fs.existsSync(path.join(dest, ".apc/skills/presupuestos/plantilla.md")));

    // Un paquete de antes (sin las skills globales) se sigue importando igual.
    const old = { ...JSON.parse(out.content), skills: [] };
    const prev = await b.client.call("projects.import", {
      content: JSON.stringify(old),
      name: "Ventas Antiguo",
      save: true,
      replace: false,
    });
    assert.equal(prev.saved, true);
    assert.equal(prev.skill_conflicts, undefined);
  } finally {
    await a.core.close();
    await a.cleanup();
    await b.core.close();
    await b.cleanup();
  }
});
