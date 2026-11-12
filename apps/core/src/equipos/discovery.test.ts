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
