// EQUIPOS-AGENTE-1 · El superagente no podía usar un equipo conectado por terminal remota (SSH) aunque el dueño tuviera
// «Dejar que los agentes lo usen» encendido: las herramientas equipo_* solo se ofrecían con un portátil emparejado en
// línea, así que acababa capturando la pantalla local y leyendo el permiso del ordenador aislado. Aquí se reproduce.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { testConfig } from "../config.ts";
import type { TeamComputer } from "../domain/team-computers.ts";
import { callTool, inputOrEnd, say, scriptedLlm, texts } from "../engine/testkit.ts";
import { createSshEquipos, type SshExec } from "../equipos/ssh.ts";
import { createSecrets } from "../secrets.ts";
import { createCore } from "../server.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { equipoCapOn, equiposBrief, equipoTools, resolveEquipo } from "./equipos.ts";

const TOKEN = "dueno-token";
const IP = "192.168.1.3";
const NAME = "DESKTOP-EVN2V0D";
const ran: string[] = [];
const fakeSsh: SshExec = async (_t, command) => {
  ran.push(command);
  if (command.startsWith("hostname"))
    return { code: 0, stdout: Buffer.from(`${NAME}\nLinux\n`), stderr: "", timedOut: false };
  return { code: 0, stdout: Buffer.from(`hecho: ${command}`), stderr: "", timedOut: false };
};

// El modelo de pega: pide ejecutar `hostname` en el equipo que le nombran si tiene la herramienta; si no, lo dice.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`resultado: ${String(req.messages.at(-1)?.content ?? "")}`);
  const offered = req.tools.some((t) => t.function.name === "equipo_run");
  if (!said.startsWith("usa ")) return say("ok");
  return offered
    ? callTool("c1", "equipo_run", { equipo: said.slice(4), command: "hostname" })
    : say("SIN HERRAMIENTA");
});
const offered = () =>
  (llm.calls.at(-1)?.tools ?? []).map((t) => t.function.name).filter((n) => n.startsWith("equipo_"));
const system = () => String(llm.calls.at(-1)?.messages[0]?.content ?? "");

let home: string;
let core: Awaited<ReturnType<typeof createCore>>;
let owner: ColoniaClient;
let id: string;

/** Un mensaje del dueño al superagente; devuelve la tarjeta que quedó esperando (ya respondida), si la hubo. */
async function tell(text: string, scope?: "once" | "session", thread?: string) {
  const t = thread ?? (await owner.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  await owner.call("threads.send", { thread: t, text });
  const input = await inputOrEnd(owner, t);
  if (input) {
    await owner.call("runs.respond", { input: input.id, decision: "approve", ...(scope ? { scope } : {}) });
    assert.equal(await inputOrEnd(owner, t), undefined, "tras aprobar no queda otra tarjeta");
  }
  const said = texts((await owner.call("threads.get", { thread: t })).messages).join("\n");
  return { thread: t, input, said };
}

before(async () => {
  home = tempDir("colonia-eq-agente-").path;
  core = await createCore(
    {
      ...testConfig({
        home,
        providers: [{ id: "fake", transport: "openai-chat", base_url: "http://fake.test", key: "none", models: [] }],
      }),
      token: TOKEN,
    },
    {
      quiet: true,
      llm,
      equipoOff: true,
      equipoSsh: createSshEquipos({ secrets: createSecrets(home, "file"), exec: fakeSsh }),
      equipoDiscover: async () => ({ tailscale: false, equipos: [] }),
    },
  );
  core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
  core.store.settings.set("model_aux", "off");
  owner = new ColoniaClient({ url: core.url, token: TOKEN });
  // Total: ni así se salta la tarjeta de un equipo por terminal remota.
  await owner.call("agents.update", { agent: "superagent", autonomy: "total" });
  id = (await owner.call("equipos.connect", { host: IP, user: "adero", password: "x" })).id;
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("con el interruptor apagado no hay herramientas, y el agente sabe dónde se enciende: Mis equipos", async () => {
  const r = await tell(`usa ${NAME}`);
  assert.equal(r.said.includes("SIN HERRAMIENTA"), true);
  assert.deepEqual(offered(), []);
  const line = system()
    .split("\n")
    .find((l) => l.includes(NAME));
  assert.match(line ?? "", /not open to agents/);
  assert.match(line ?? "", /«Dejar que los agentes lo usen».*\[Mis equipos\]\(colonia:equipos\)/);
});

test("con el interruptor encendido, un equipo por terminal remota da al superagente sus herramientas y lo ve en el prompt", async () => {
  await owner.call("equipos.set_access", { id, enabled: true });
  ran.length = 0;
  const r = await tell(`usa ${IP}`, "session");
  // Sin el arreglo: ninguna herramienta equipo_* (solo contaban los portátiles emparejados y en línea).
  assert.deepEqual(offered(), [
    "equipo_list",
    "equipo_run",
    "equipo_read_file",
    "equipo_list_files",
    "equipo_write_file",
  ]);
  const line = system()
    .split("\n")
    .find((l) => l.includes(NAME));
  assert.match(line ?? "", /you may use: DESKTOP-EVN2V0D \(linux, 192\.168\.1\.3, remote terminal\)/);
  assert.match(line ?? "", /screen_snapshot, screen_open, screen_do and the shell act on the machine Colonia runs on/);
  // Nombrado por su IP, se ejecuta ALLÍ; y antes pide la tarjeta, aunque el agente esté en Total.
  assert.equal(r.input?.tool, "equipo_run");
  assert.equal(r.input?.detail, `Ejecutar en «${IP}»: hostname`);
  assert.deepEqual(r.input?.approval_scopes, ["once", "session", "always"]);
  assert.equal(ran.filter((c) => c.includes("hostname")).length, 1);
  assert.match(r.said, /resultado: exit code 0/);

  // Aprobado para este chat: la segunda vez no pregunta. En otro chat, vuelve a pedirlo.
  const again = await tell(`usa ${NAME.toLowerCase()}`, undefined, r.thread);
  assert.equal(again.input, undefined);
  assert.equal(ran.filter((c) => c.includes("hostname")).length, 2);
  const other = await tell(`usa adero@${IP}`, "once");
  assert.equal(other.input?.tool, "equipo_run");
  assert.equal(ran.filter((c) => c.includes("hostname")).length, 3);
  const log = (await owner.call("equipos.audit", { id })).entries.filter((e) => e.kind === "peticion");
  assert.equal(log.length, 3);
});

const pc = (over: Partial<TeamComputer>): TeamComputer => ({
  id: "eqp_1",
  name: "salon-pc",
  platform: "windows",
  public_key: "",
  agent_access: true,
  created_at: "2026-11-13T00:00:00Z",
  ...over,
});

test("el cap de equipos cuenta los de terminal remota aunque no haya ningún portátil en línea", () => {
  const nadie = () => false;
  assert.equal(equipoCapOn([pc({ transport: "ssh", address: IP })], nadie), true);
  assert.equal(equipoCapOn([pc({ transport: "ssh", address: IP, agent_access: false })], nadie), false);
  assert.equal(equipoCapOn([pc({})], nadie), false);
  assert.equal(
    equipoCapOn([pc({})], (i) => i === "eqp_1"),
    true,
  );
});

test("un equipo se resuelve por id, por nombre o por dirección", () => {
  const all = [pc({ transport: "ssh", address: IP }), pc({ id: "eqp_2", name: "Portátil de Ana" })];
  assert.equal(resolveEquipo(all, "eqp_2")?.id, "eqp_2");
  assert.equal(resolveEquipo(all, " SALON-PC ")?.id, "eqp_1");
  assert.equal(resolveEquipo(all, "«portátil de ana»")?.id, "eqp_2");
  assert.equal(resolveEquipo(all, IP)?.id, "eqp_1");
  assert.equal(resolveEquipo(all, `adero@${IP}`)?.id, "eqp_1");
  assert.equal(resolveEquipo(all, "192.168.1.30"), undefined);
});

test("pedir un equipo cerrado a los agentes dice el sitio real con su enlace, sin preguntar al dueño", async () => {
  const all = [
    pc({ transport: "ssh", address: IP }),
    pc({ id: "eqp_2", name: "Portátil de Ana", agent_access: false }),
  ];
  for (const [lang, link, toggle] of [
    ["es", "[Mis equipos](colonia:equipos)", "«Dejar que los agentes lo usen»"],
    ["en", "[My computers](colonia:equipos)", '"Let agents use it"'],
  ] as const) {
    const store = { team: { list: () => all }, settings: { get: () => lang } } as never;
    const run = equipoTools(store).find((t) => t.name === "equipo_run");
    const check = async (equipo: string) => run?.check?.({ equipo, command: "hostname" }, {} as never);
    await assert.rejects(
      check("Portátil de Ana"),
      (e: Error) => e.message.includes(link) && e.message.includes(toggle),
    );
    await assert.rejects(check("otro"), /no computer of the owner is called or at "otro"\. They are: salon-pc/);
    await check(IP);
    assert.equal(run?.keepsCard?.({ equipo: IP }, {} as never), "grant");
    assert.equal(run?.keepsCard?.({ equipo: "eqp_2" }, {} as never), undefined);
    assert.equal(equiposBrief(store).includes(`${toggle} on its card in ${link}`), true);
  }
  assert.equal(equiposBrief({ team: { list: () => [] }, settings: { get: () => "es" } } as never), "");
});
