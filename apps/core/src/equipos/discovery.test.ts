// EQUIPOS-SIN-AGENTE-1 · Descubrimiento de equipos: parseo de ARP y Tailscale, adivinar el sistema y sondeo de puertos
// contra un servidor local efímero (nunca la red real).
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { guessOs, parseArp, parseTailscaleStatus, probePorts } from "./discovery.ts";

test("ARP de Windows: válidas sí, difusión, multicast y cabeceras no", () => {
  const text = [
    "",
    "Interface: 192.168.1.10 --- 0x7",
    "  Internet Address      Physical Address      Type",
    "  192.168.1.1           aa-bb-cc-dd-ee-01     dynamic",
    "  192.168.1.20          AA-BB-CC-DD-EE-FF     dynamic",
    "  192.168.1.255         ff-ff-ff-ff-ff-ff     static",
    "  224.0.0.22            01-00-5e-00-00-16     static",
  ].join("\r\n");
  assert.deepEqual(parseArp(text, "windows"), [
    { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" },
    { ip: "192.168.1.20", mac: "aa:bb:cc:dd:ee:ff" },
  ]);
});

test("ARP de Linux (arp -an e ip neigh): descarta incompletas e IPv6", () => {
  const text = [
    "? (192.168.1.1) at aa:bb:cc:dd:ee:01 [ether] on eth0",
    "? (192.168.1.7) at <incomplete> on eth0",
    "? (192.168.1.8) at (incomplete) on eth0",
    "192.168.1.30 dev eth0 lladdr aa:bb:cc:dd:ee:30 REACHABLE",
    "192.168.1.31 dev eth0  FAILED",
    "fe80::1 dev eth0 lladdr aa:bb:cc:dd:ee:99 router STALE",
    "basura",
  ].join("\n");
  assert.deepEqual(parseArp(text, "linux"), [
    { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" },
    { ip: "192.168.1.30", mac: "aa:bb:cc:dd:ee:30" },
  ]);
});

test("ARP de mac: MAC con octetos sin cero delante y entradas de difusión", () => {
  const text = [
    "? (192.168.1.1) at a:b:c:d:e:f on en0 ifscope [ethernet]",
    "? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]",
    "? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]",
    "? (192.168.1.9) at (incomplete) on en0 ifscope [ethernet]",
  ].join("\n");
  assert.deepEqual(parseArp(text, "darwin"), [{ ip: "192.168.1.1", mac: "0a:0b:0c:0d:0e:0f" }]);
});

const TS = JSON.stringify({
  Self: { HostName: "principal", TailscaleIPs: ["100.64.0.1", "fd7a::1"], OS: "windows", Online: true },
  Peer: {
    k1: { HostName: "portatil", TailscaleIPs: ["100.64.0.2", "fd7a::2"], OS: "macOS", Online: true },
    k2: { HostName: "nas", TailscaleIPs: ["100.64.0.3"], OS: "linux", Online: false },
  },
});

test("Tailscale: pares sin el propio, y con él si se pide", () => {
  assert.deepEqual(parseTailscaleStatus(TS), [
    { name: "portatil", ip: "100.64.0.2", os: "macOS", online: true },
    { name: "nas", ip: "100.64.0.3", os: "linux", online: false },
  ]);
  assert.equal(parseTailscaleStatus(TS, { includeSelf: true })[0]?.name, "principal");
});

test("Tailscale: sin Peer o JSON roto da lista vacía", () => {
  assert.deepEqual(parseTailscaleStatus(JSON.stringify({ Self: { HostName: "x" } })), []);
  assert.deepEqual(parseTailscaleStatus("{no es json"), []);
  assert.deepEqual(parseTailscaleStatus("null"), []);
});

test("guessOs", () => {
  assert.equal(guessOs([3389]), "windows");
  assert.equal(guessOs([22, 445]), "windows");
  assert.equal(guessOs([22]), "linux/mac");
  assert.equal(guessOs([5900]), "desconocido");
  assert.equal(guessOs([]), "desconocido");
});

test("probePorts: abierto contra servidor local, cerrado en un puerto liberado", async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const open = (server.address() as net.AddressInfo).port;
  const tmp = net.createServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", () => r()));
  const closed = (tmp.address() as net.AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
  try {
    assert.deepEqual(await probePorts("127.0.0.1", [open, closed], 400), [open]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// EQUIPOS-RED-3 · Barrido de la red local, sin tocar la red: interfaces, exec y sondeo inyectados.
import type os from "node:os";
import {
  discoverEquipos,
  type Exec,
  hostsOf,
  type LocalSubnet,
  localSubnets,
  parseGateways,
  parseNbtstat,
} from "./discovery.ts";

const nic = (address: string, netmask: string, internal = false) =>
  ({ address, netmask, family: "IPv4", mac: "00:00:00:00:00:00", internal, cidr: null }) as os.NetworkInterfaceInfo;

test("localSubnets: sólo redes privadas de adaptadores reales, como mucho un /24", () => {
  const subs = localSubnets({
    "Wi-Fi": [nic("192.168.1.54", "255.255.255.0")],
    "vEthernet (Default Switch)": [nic("172.20.16.1", "255.255.240.0")],
    Ethernet: [nic("10.1.2.3", "255.255.0.0")],
    Loopback: [nic("127.0.0.1", "255.0.0.0", true)],
    pública: [nic("8.8.8.8", "255.255.255.0")],
    pequeña: [nic("192.168.5.10", "255.255.255.252")],
  });
  assert.deepEqual(subs, [
    { address: "192.168.1.54", first: "192.168.1.1", last: "192.168.1.254" },
    { address: "10.1.2.3", first: "10.1.2.1", last: "10.1.2.254" },
    { address: "192.168.5.10", first: "192.168.5.9", last: "192.168.5.10" },
  ]);
  assert.equal(hostsOf(subs[0] as LocalSubnet).length, 254);
});

test("parseGateways y parseNbtstat", () => {
  assert.deepEqual(parseGateways("          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.54     30\r\n"), [
    "192.168.1.1",
  ]);
  assert.deepEqual(parseGateways("default via 10.0.0.1 dev wlan0 proto dhcp\n"), ["10.0.0.1"]);
  assert.deepEqual(parseGateways("default            192.168.0.1        UGScg          en0\n"), ["192.168.0.1"]);
  const nb = [
    "    Nombre               Tipo         Estado",
    "    ---------------------------------------------",
    "    SALON-PC       <00>  ÚNICO       Registrado",
    "    WORKGROUP      <00>  Grupo       Registrado",
  ].join("\r\n");
  assert.equal(parseNbtstat(nb.replace("ÚNICO", "UNIQUE")), "SALON-PC");
  assert.equal(parseNbtstat("Host no encontrado."), null);
});

test("discoverEquipos: barre la subred, encuentra equipos fuera de ARP y no descarta los que no abren nada", async () => {
  let arpReads = 0;
  const swept: string[] = [];
  const exec: Exec = async (cmd) => {
    if (cmd === "arp") {
      arpReads++;
      // El equipo .70 calla a todo, pero tras el barrido ya aparece en la tabla ARP.
      return "  192.168.1.1   aa-bb-cc-dd-ee-01  dynamic\n  192.168.1.70  aa-bb-cc-dd-ee-70  dynamic\n  172.20.16.5  aa-bb-cc-dd-ee-99  dynamic\n";
    }
    if (cmd === "route") return "          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.54     30\n";
    return null;
  };
  const probe = async (ip: string) => {
    swept.push(ip);
    if (ip === "192.168.1.1") return { alive: true, open: [80, 443] };
    if (ip === "192.168.1.40") return { alive: true, open: [22] };
    if (ip === "192.168.1.60") return { alive: true, open: [] }; // sólo «connection refused»
    return { alive: false, open: [] };
  };
  const t0 = Date.now();
  const r = await discoverEquipos({
    exec,
    probe,
    platform: "win32",
    interfaces: {
      "Wi-Fi": [nic("192.168.1.54", "255.255.255.0")],
      "vEthernet (WSL)": [nic("172.20.16.1", "255.255.240.0")],
    },
    resolveName: async (ip) => (ip === "192.168.1.60" ? "SALON-PC" : null),
    identify: async () => new Map(),
  });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(swept.length, 253, "254 direcciones menos la propia");
  assert.ok(!swept.includes("192.168.1.54"));
  assert.ok(arpReads >= 1);
  assert.deepEqual(
    r.equipos.map((e) => [e.ip, e.name, e.ports, e.online]),
    [
      ["192.168.1.40", "192.168.1.40", [22], true],
      ["192.168.1.60", "SALON-PC", [], true],
      ["192.168.1.70", "192.168.1.70", [], true],
    ],
  );
  assert.equal(r.equipos[0]?.os, "linux/mac");
});

test("discoverEquipos: sin redes locales no barre nada y conserva ARP", async () => {
  let probes = 0;
  const r = await discoverEquipos({
    exec: async (cmd) => (cmd === "arp" ? "  192.168.1.9  aa-bb-cc-dd-ee-09  dynamic\n" : null),
    probe: async () => {
      probes++;
      return { alive: false, open: [] };
    },
    platform: "win32",
    interfaces: {},
    resolveName: async () => null,
    identify: async () => new Map(),
  });
  assert.equal(probes, 1);
  assert.deepEqual(
    r.equipos.map((e) => [e.ip, e.ports]),
    [["192.168.1.9", []]],
  );
});

// EQUIPOS-NOMBRE-1 · La identificación por UDP se pide para los equipos de la red con su MAC, y su nombre propio
// (Bonjour) gana al NetBIOS del sistema.
test("discoverEquipos: pasa MAC y puertos a la identificación y usa su tipo, fabricante y nombre", async () => {
  let asked: { ip: string; mac?: string; ports: number[] }[] = [];
  let iface: string | undefined;
  const r = await discoverEquipos({
    exec: async (cmd) =>
      cmd === "arp" ? "  192.168.1.20  ce-16-76-5e-d0-3e  dynamic\n  192.168.1.30  aa-bb-cc-dd-ee-30  dynamic\n" : null,
    probe: async (ip) => ({ alive: ip === "192.168.1.30", open: ip === "192.168.1.30" ? [445] : [] }),
    platform: "win32",
    interfaces: { "Wi-Fi": [nic("192.168.1.54", "255.255.255.0")] },
    resolveName: async (ip) => (ip === "192.168.1.30" ? "MAC-6BF692" : null),
    identify: async (hosts, i) => {
      asked = hosts;
      iface = i;
      return new Map([
        ["192.168.1.20", { kind: "movil" as const, privateMac: true }],
        [
          "192.168.1.30",
          {
            name: "MacBook-de-Ana",
            ownName: true,
            vendor: "Apple",
            model: "Mac15,12",
            kind: "ordenador" as const,
            privateMac: false,
          },
        ],
      ]);
    },
  });
  assert.equal(iface, "192.168.1.54");
  assert.deepEqual(
    asked.sort((a, b) => a.ip.localeCompare(b.ip)),
    [
      { ip: "192.168.1.20", mac: "ce:16:76:5e:d0:3e", ports: [] },
      { ip: "192.168.1.30", mac: "aa:bb:cc:dd:ee:30", ports: [445] },
    ],
  );
  assert.deepEqual(
    r.equipos.map((e) => [e.ip, e.name, e.kind, e.vendor, e.model, e.privateMac]),
    [
      ["192.168.1.20", "192.168.1.20", "movil", undefined, undefined, true],
      ["192.168.1.30", "MacBook-de-Ana", "ordenador", "Apple", "Mac15,12", undefined],
    ],
  );
});
