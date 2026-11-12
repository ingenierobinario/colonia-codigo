// EQUIPOS-SIN-AGENTE-1 · Buscar equipos y conectarlos por SSH sin instalar nada en ellos. El `ssh` del sistema y la
// búsqueda en la red se cambian por dobles: aquí se prueba el contrato de los RPC, no una red real.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ColoniaClient } from "@colonia/protocol/client";
import { testConfig } from "../config.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import { createSecrets } from "../secrets.ts";
import { createCore } from "../server.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { discoverEquipos, type Exec } from "./discovery.ts";
import { createSshEquipos, explainSshError, type SshExec, type SshTarget, shQuote } from "./ssh.ts";

const TOKEN = "dueno-token";
const calls: Array<{ t: SshTarget; command: string; input?: Buffer | undefined }> = [];
const fakeSsh: SshExec = async (t, command, _ms, input) => {
  calls.push({ t, command, input });
  if (t.password !== "buena")
    return { code: 255, stdout: Buffer.alloc(0), stderr: "Permission denied", timedOut: false };
  if (command.startsWith("hostname"))
    return { code: 0, stdout: Buffer.from("salon-pc\nLinux\n"), stderr: "", timedOut: false };
  if (command.startsWith("wc -c"))
    return { code: 0, stdout: Buffer.from("5\naG9sYQo=\n"), stderr: "", timedOut: false };
  // EQUIPOS-SIN-AGENTE-2: escribir lee el contenido por la entrada estándar y contesta con el tamaño.
  if (command.startsWith("cat > "))
    return { code: 0, stdout: Buffer.from(`${input?.length ?? 0}\n`), stderr: "", timedOut: false };
  if (command.startsWith("ls -lA"))
    return { code: 0, stdout: Buffer.from("-rw-r--r-- 1 ana ana 5 nota.txt\n"), stderr: "", timedOut: false };
  return { code: 0, stdout: Buffer.from(`hecho: ${command}`), stderr: "", timedOut: false };
};

let home: string;
let core: Awaited<ReturnType<typeof createCore>>;
let owner: ColoniaClient;

before(async () => {
  home = tempDir("colonia-eq-ssh-").path;
  core = await createCore(
    { ...testConfig({ home }), token: TOKEN },
    {
      quiet: true,
      llm: scriptedLlm(() => say("ok")),
      equipoOff: true,
      equipoSsh: createSshEquipos({ secrets: createSecrets(home, "file"), exec: fakeSsh }),
      equipoDiscover: async () => ({
        tailscale: true,
        equipos: [
          {
            name: "salon-pc",
            ip: "192.168.1.40",
            os: "linux/mac",
            via: "red",
            online: true,
            ports: [22],
            opens: ["Terminal"],
          },
        ],
      }),
    },
  );
  owner = new ColoniaClient({ url: core.url, token: TOKEN });
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("discover devuelve lo encontrado y deja de ofrecerlo cuando ya está añadido", async () => {
  const first = await owner.call("equipos.discover", {});
  assert.equal(first.tailscale, true);
  assert.deepEqual(
    first.equipos.map((e) => [e.ip, e.opens]),
    [["192.168.1.40", ["Terminal"]]],
  );
});

test("connect con contraseña mala no guarda nada y explica el motivo", async () => {
  await assert.rejects(
    owner.call("equipos.connect", { host: "192.168.1.40", user: "ana", password: "mala" }),
    /usuario o la contraseña/,
  );
  assert.equal((await owner.call("equipos.list", {})).equipos.length, 0);
});

test("connect rechaza usuarios y equipos con aspecto de opción u orden", async () => {
  await assert.rejects(owner.call("equipos.connect", { host: "-oProxyCommand=x", user: "ana", password: "buena" }));
  await assert.rejects(owner.call("equipos.connect", { host: "192.168.1.40", user: "-oX", password: "buena" }));
  await assert.rejects(owner.call("equipos.connect", { host: "192.168.1.40", user: "ana;rm", password: "buena" }));
});

test("connect bueno: queda en la lista, conectado, con el interruptor apagado y la contraseña fuera de la base", async () => {
  const e = await owner.call("equipos.connect", { host: "192.168.1.40", user: "ana", password: "buena" });
  assert.equal(e.name, "salon-pc");
  assert.equal(e.platform, "linux");
  assert.equal(e.via, "ssh");
  assert.equal(e.address, "192.168.1.40");
  assert.equal(e.connected, true);
  assert.equal(e.agent_access, false);
  const listed = (await owner.call("equipos.list", {})).equipos;
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes("buena"), false);
  assert.deepEqual((await owner.call("equipos.discover", {})).equipos, []);
});

test("run / read_file / list_files / write_file por SSH respetan el interruptor y quedan en la actividad", async () => {
  const [e] = (await owner.call("equipos.list", {})).equipos;
  assert.ok(e);
  await assert.rejects(owner.call("equipos.run", { equipo: e.id, command: "uptime" }), /desactivado/);
  await owner.call("equipos.set_access", { id: e.id, enabled: true });
  const r = await owner.call("equipos.run", { equipo: "salon-pc", command: "uptime", cwd: "/home/ana" });
  assert.equal(r.exit_code, 0);
  assert.match(r.output, /hecho: cd '\/home\/ana' && uptime/);
  const f = await owner.call("equipos.read_file", { equipo: e.id, path: "/home/ana/nota.txt" });
  assert.equal(Buffer.from(f.content_base64, "base64").toString(), "hola\n");
  assert.equal(f.size, 5);
  const l = await owner.call("equipos.list_files", { equipo: e.id, path: "/home/ana" });
  assert.match(l.output, /nota\.txt/);
  const w = await owner.call("equipos.write_file", {
    equipo: e.id,
    path: "/home/ana/it's.txt",
    content_base64: Buffer.from("adiós\n").toString("base64"),
  });
  assert.equal(w.written, Buffer.byteLength("adiós\n"));
  const wc = calls.at(-1);
  const q = shQuote("/home/ana/it's.txt");
  assert.equal(q, String.raw`'/home/ana/it'\''s.txt'`);
  assert.equal(wc?.command, `cat > ${q} && wc -c < ${q}`);
  assert.equal(wc?.input?.toString("utf8"), "adiós\n");
  const kinds = (await owner.call("equipos.audit", { id: e.id })).entries.map((x) => x.kind);
  assert.ok(kinds.includes("emparejado") && kinds.includes("hecho"));
  assert.equal((await owner.call("equipos.revoke", { id: e.id })).revoked, true);
  assert.equal((await owner.call("equipos.list", {})).equipos.length, 0);
  await assert.rejects(owner.call("equipos.run", { equipo: e.id, command: "uptime" }));
});

test("shQuote y los mensajes de error de ssh", () => {
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
  const out = (stderr: string) => ({ code: 255, stdout: Buffer.alloc(0), stderr, timedOut: false });
  assert.match(explainSshError(out("ssh: connect to host x port 22: Connection refused")), /no acepta/);
  assert.match(explainSshError({ ...out(""), timedOut: true }), /no responde/);
});

test("discoverEquipos: junta ARP y Tailscale, descarta lo que no abre nada y no rompe sin Tailscale", async () => {
  const arp = "  192.168.1.1   aa-bb-cc-dd-ee-01  dynamic\n  192.168.1.40  aa-bb-cc-dd-ee-40  dynamic\n";
  const ts = JSON.stringify({
    Peer: { k: { HostName: "portatil", TailscaleIPs: ["100.64.0.2"], OS: "windows", Online: false } },
  });
  const exec =
    (withTs: boolean): Exec =>
    async (cmd) =>
      cmd === "arp" ? arp : cmd === "tailscale" && withTs ? ts : null;
  const probe = async (ip: string) => (ip === "192.168.1.40" ? [22, 445] : []);
  const r = await discoverEquipos({ exec: exec(true), probe, platform: "win32" });
  assert.equal(r.tailscale, true);
  assert.deepEqual(
    r.equipos.map((e) => [e.ip, e.via, e.os, e.opens]),
    [
      ["100.64.0.2", "tailscale", "windows", []],
      ["192.168.1.40", "red", "windows", ["Terminal", "Carpetas"]],
    ],
  );
  const sinTs = await discoverEquipos({ exec: exec(false), probe, platform: "win32" });
  assert.equal(sinTs.tailscale, false);
  assert.equal(sinTs.equipos.length, 1);
});
