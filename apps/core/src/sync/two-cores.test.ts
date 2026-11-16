// D-192 fase 2 · Dos Colonias enteras (dos carpetas, dos servidores, sus RPC de verdad): se emparejan con un código,
// lo que se cambia en una aparece en la otra y al revés, un conflicto deja su versión guardada, y un canal de sesión
// única solo está abierto en un equipo a la vez.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "@colonia/protocol/flow-graph";
import type { ChannelAdapter } from "../channels/types.ts";
import { openDb } from "../db/db.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "start", kind: "webhook", label: "Webhook" }],
  edges: [],
  layout: [],
};
const until = (f: () => unknown | Promise<unknown>, what: string) =>
  waitFor(async () => Boolean(await f()), what, { ms: 20_000 });

/** Un equipo: cuenta cuántas veces se abre y se cierra la sesión de cada canal. */
function machine(home: string) {
  const sessions = { open: new Set<string>(), starts: 0 };
  const adapter = (id: string): ChannelAdapter => ({
    caps: { typing: false, buttons: false },
    start: async () => {
      sessions.starts++;
      sessions.open.add(id);
      return { account: `@${id}` };
    },
    stop: async () => void sessions.open.delete(id),
    send: async () => ({}),
  });
  const boot = () =>
    startCore({ home, llm: scriptedLlm(() => say("ok")), channelAdapters: { telegram: (c) => adapter(c.id) } });
  return { boot, sessions };
}

const names = {
  projects: async (e: Env) => (await e.client.call("projects.list", {})).projects.map((p) => p.name),
  agents: async (e: Env) => (await e.client.call("agents.list", {})).agents.map((a) => a.name),
  flows: async (e: Env) => (await e.client.call("flows.list", {})).flows.map((f) => f.name),
  providers: async (e: Env) =>
    (await e.client.call("providers.list", {})).providers.map((p) => `${p.id}:${p.key_hint ?? ""}`),
  channels: async (e: Env) => (await e.client.call("channels.list", {})).channels.map((c) => c.id),
  apps: async (e: Env) => (await e.client.call("webapps.list", {})).apps.map((a) => a.name),
  browsers: async (e: Env) => (await e.client.call("navegadores.list", {})).navegadores.map((n) => n.name),
};

/** Una cosa de cada categoría, hecha en `from` con las RPC de siempre; tiene que aparecer en `to`. */
async function oneOfEach(from: Env, to: Env, tag: string) {
  const low = tag.toLowerCase();
  const { project } = await from.client.call("projects.create", { name: `Proyecto ${tag}`, kind: "company" });
  await from.client.call("agents.create", {
    project_id: project.id,
    slug: `agente-${low}`,
    name: `Agente ${tag}`,
    role: "Ventas",
    prompt: `Eres el agente ${tag}.`,
  });
  await from.client.call("flows.create", { project: project.id, name: `Flow ${tag}`, graph });
  await from.client.call("providers.set", {
    id: `ia-${low}`,
    provider: { label: `IA ${tag}`, transport: "openai-chat", base_url: "https://ia.example.com/v1" },
    api_key: `sk-clave-secreta-${low}-9${low}9z`,
  });
  await from.client.call("channels.set", {
    id: `canal-${low}`,
    channel: { type: "telegram", agent_id: "superagent", label: `Canal ${tag}`, enabled: true },
    token: `123456:token-${low}`,
  });
  await from.client.call("webapps.set", { id: `app-${low}`, app: { name: `App ${tag}`, url: "https://app.example.com" } });
  await from.client.call("navegadores.set", { id: `nav-${low}`, navegador: { browser: "chrome", name: `Perfil ${tag}` } });

  await until(async () => (await names.projects(to)).includes(`Proyecto ${tag}`), `el proyecto ${tag} no llegó`);
  // La jerarquía: el agente y el Flow llegan dentro de su proyecto, no sueltos.
  await until(async () => {
    const { agents } = await to.client.call("agents.list", {});
    return agents.some((a) => a.name === `Agente ${tag}` && a.project_id === project.id);
  }, `el agente ${tag} no llegó dentro de su proyecto`);
  await until(
    async () => (await to.client.call("flows.list", { project: project.id })).flows.some((f) => f.name === `Flow ${tag}`),
    `el Flow ${tag} no llegó dentro de su proyecto`,
  );
  // La IA llega con su clave (solo se ve el final, igual que en el equipo donde se puso).
  await until(async () => (await names.providers(to)).includes(`ia-${low}:${`9${low}9z`.slice(-4)}`), `la IA ${tag} no llegó con su clave`);
  await until(async () => (await names.channels(to)).includes(`canal-${low}`), `el canal ${tag} no llegó`);
  await until(async () => (await names.apps(to)).includes(`App ${tag}`), `la aplicación ${tag} no llegó`);
  await until(async () => (await names.browsers(to)).includes(`Perfil ${tag}`), `el navegador ${tag} no llegó`);
  return project.id;
}

test("dos Colonias emparejadas se ven iguales; un conflicto se guarda; la sesión de un canal vive en un solo equipo", async () => {
  const homes = [tempDir("colonia-dos-a-").path, tempDir("colonia-dos-b-").path] as const;
  const ma = machine(homes[0]);
  const mb = machine(homes[1]);
  const a = await ma.boot();
  let b = await mb.boot();
  try {
    // Sin emparejar: nada puesto, y un canal se abre aquí como siempre.
    const idle = await a.client.call("sync.status", {});
    assert.equal(idle.paired, false);
    assert.equal(idle.saved, 0);
    await a.client.call("channels.set", {
      id: "canal-previo",
      channel: { type: "telegram", agent_id: "superagent", enabled: true },
      token: "123456:token-previo",
    });
    await until(() => ma.sessions.open.has("canal-previo"), "sin emparejar, el canal no se abrió");

    // Emparejar: A enseña el código, B lo escribe.
    const shown = await a.client.call("sync.pair_start", {});
    assert.ok(shown.pairing?.code, "no hay código");
    await assert.rejects(b.client.call("sync.pair_join", { code: "esto-no-es-un-codigo" }));
    const joined = await b.client.call("sync.pair_join", { code: shown.pairing.code });
    assert.equal(joined.paired, true);
    assert.equal(joined.role, "secundario");
    await until(async () => (await a.client.call("sync.status", {})).connected, "A no ve a B");
    assert.equal((await a.client.call("sync.status", {})).role, "principal");

    // Lo que A ya tenía aparece en B, y su sesión no se abre dos veces.
    await until(async () => (await names.channels(b)).includes("canal-previo"), "lo que ya había en A no llegó a B");

    // Cada categoría, en los dos sentidos.
    const pa = await oneOfEach(a, b, "Alfa");
    await oneOfEach(b, a, "Beta");
    for (const k of Object.keys(names) as (keyof typeof names)[]) {
      // El orden de las listas es de cada equipo; lo que hay es lo mismo.
      await until(
        async () => JSON.stringify((await names[k](a)).sort()) === JSON.stringify((await names[k](b)).sort()),
        `los dos equipos no enseñan lo mismo en ${k}`,
      );
    }

    // Sesión única: los tres canales están abiertos en A (principal) y ninguno en B, que los ve a través de A.
    const all = ["canal-previo", "canal-alfa", "canal-beta"];
    await until(() => all.every((id) => ma.sessions.open.has(id)), "el principal no abrió todos los canales");
    assert.deepEqual([...mb.sessions.open], [], "el secundario abrió una sesión que ya lleva el principal");
    assert.equal(mb.sessions.starts, 0);
    await until(async () => {
      const { channels } = await b.client.call("channels.list", {});
      return all.every((id) => channels.find((c) => c.id === id)?.status === "running");
    }, "el secundario no ve el estado de los canales del principal");

    // Los canales pasan a B: se cierran en A antes de quedar abiertos en B; nunca en los dos.
    await b.client.call("sync.make_principal", {});
    await until(() => all.every((id) => mb.sessions.open.has(id)), "el nuevo principal no abrió los canales");
    await until(() => ma.sessions.open.size === 0, "el anterior principal no cerró sus sesiones");
    assert.equal((await a.client.call("sync.status", {})).role, "secundario");
    await a.client.call("sync.make_principal", {});
    await until(() => all.every((id) => ma.sessions.open.has(id)) && mb.sessions.open.size === 0, "no volvieron a A");

    // Conflicto: B está cerrado, los dos cambian el nombre del mismo proyecto; B, el último.
    await b.core.close();
    await a.client.call("projects.update", { project: pa, name: "Versión de A" });
    await new Promise((ok) => setTimeout(ok, 1100));
    const offline = openDb(homes[1]);
    offline.prepare("UPDATE projects SET name = 'Versión de B' WHERE id = ?").run(pa);
    offline.close();
    b = await mb.boot();
    await until(async () => (await names.projects(a)).includes("Versión de B"), "no ganó el último cambio");
    assert.ok(!(await names.projects(a)).includes("Versión de A"));
    await until(
      async () =>
        (await a.client.call("sync.status", {})).saved === 1 && (await b.client.call("sync.status", {})).saved === 1,
      "la versión perdida no quedó guardada en los dos equipos",
    );
    const { items, total } = await b.client.call("sync.saved", {});
    assert.equal(total, 1);
    assert.deepEqual(
      { kind: items[0]?.kind, label: items[0]?.label, mine: items[0]?.mine },
      { kind: "project", label: "Versión de A", mine: false },
    );
    assert.equal((await a.client.call("sync.saved", {})).items[0]?.mine, true);
    assert.deepEqual(await b.client.call("sync.recover", { id: items[0]?.id ?? "" }), { ok: true });
    await until(async () => (await names.projects(a)).includes("Versión de A"), "lo recuperado no llegó al otro equipo");
    await until(async () => (await names.projects(b)).includes("Versión de A"), "lo recuperado no quedó puesto");
    // Tras reiniciar, B sigue de secundario: no abrió ninguna sesión por su cuenta.
    assert.equal(mb.sessions.open.size, 0);

    // Desemparejar: cada uno se queda con lo suyo y los canales siguen en el que los llevaba.
    await b.client.call("sync.unpair", {});
    await until(async () => !(await a.client.call("sync.status", {})).paired, "A sigue emparejado");
    assert.equal((await b.client.call("sync.status", {})).paired, false);
    assert.ok(all.every((id) => ma.sessions.open.has(id)));
    assert.equal(mb.sessions.open.size, 0);
    await a.client.call("projects.create", { name: "Solo en A" });
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.ok(!(await names.projects(b)).includes("Solo en A"), "desemparejados, siguió llegando");
  } finally {
    await a.core.close().catch(() => {});
    await b.core.close().catch(() => {});
    await a.cleanup();
    await b.cleanup();
    for (const h of homes) await removeDir(h);
  }
});
