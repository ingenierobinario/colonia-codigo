// EQUIPOS-NOMBRE-1 · Identificación de equipos: paquetes NetBIOS, mDNS y SSDP fabricados a mano y UDP/HTTP inyectados
// (nunca la red real).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDnsQuery,
  buildNbstatQuery,
  identifyHosts,
  inferKind,
  isRandomMac,
  parseDnsRecords,
  parseNbstatResponse,
  parseSsdpLocation,
  parseUpnpXml,
  reverseName,
  type UdpExchange,
  vendorOf,
} from "./identify.ts";

function nbstatReply(names: [string, number, boolean][]): Buffer {
  const q = buildNbstatQuery();
  const head = Buffer.from(q.subarray(0, 12));
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(0, 4);
  head.writeUInt16BE(1, 6);
  const name = q.subarray(12, 46);
  const entries = names.map(([n, suffix, group]) => {
    const b = Buffer.alloc(18, 0x20);
    b.write(n, 0, "latin1");
    b[15] = suffix;
    b.writeUInt16BE(group ? 0x8400 : 0x0400, 16);
    return b;
  });
  const rdata = Buffer.concat([Buffer.from([entries.length]), ...entries, Buffer.alloc(6)]);
  const meta = Buffer.alloc(10);
  meta.writeUInt16BE(0x21, 0);
  meta.writeUInt16BE(1, 2);
  meta.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([head, name, meta, rdata]);
}

function dnsName(n: string) {
  return Buffer.concat([
    ...n.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0]),
  ]);
}
function rr(name: string, type: number, data: Buffer) {
  const m = Buffer.alloc(10);
  m.writeUInt16BE(type, 0);
  m.writeUInt16BE(1, 2);
  m.writeUInt16BE(data.length, 8);
  return Buffer.concat([dnsName(name), m, data]);
}
function dnsReply(records: Buffer[]) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(0x8400, 2);
  h.writeUInt16BE(records.length, 6);
  return Buffer.concat([h, ...records]);
}
const txt = (...kv: string[]) =>
  Buffer.concat(kv.map((s) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])));

test("NetBIOS: la consulta es «*» codificado y la respuesta da el nombre único <00>", () => {
  const q = buildNbstatQuery(0x1234);
  assert.equal(q.length, 50);
  assert.equal(q.toString("latin1", 13, 15), "CK"); // «*» = 0x2A → C K
  assert.equal(q.readUInt16BE(46), 0x21);
  const r = nbstatReply([
    ["WORKGROUP", 0, true],
    ["SALON-PC", 0x20, false],
    ["SALON-PC", 0, false],
  ]);
  assert.equal(parseNbstatResponse(r), "SALON-PC");
  assert.equal(parseNbstatResponse(Buffer.from([1, 2, 3])), null);
  assert.equal(parseNbstatResponse(q), null, "una consulta no es una respuesta");
});

test("DNS: la consulta PTR lleva el bit QU y la respuesta se lee con PTR, TXT y A", () => {
  const q = buildDnsQuery([reverseName("192.168.1.20")]);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q[q.length - 2], 0x80);
  assert.equal(reverseName("192.168.1.20"), "20.1.168.192.in-addr.arpa");
  const recs = parseDnsRecords(
    dnsReply([
      rr("20.1.168.192.in-addr.arpa", 12, dnsName("MacBook-de-Ana.local")),
      rr("x._googlecast._tcp.local", 16, txt("fn=Tele del salón", "md=Chromecast")),
      rr("ana.local", 1, Buffer.from([192, 168, 1, 20])),
    ]),
  );
  assert.deepEqual(recs, [
    { name: "20.1.168.192.in-addr.arpa", type: 12, data: "MacBook-de-Ana.local" },
    { name: "x._googlecast._tcp.local", type: 16, data: { fn: "Tele del salón", md: "Chromecast" } },
    { name: "ana.local", type: 1, data: "192.168.1.20" },
  ]);
  assert.deepEqual(parseDnsRecords(Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 5, 0, 0, 0, 0, 9])), []);
});

test("SSDP y UPnP: LOCATION y descripción del aparato", () => {
  const msg = Buffer.from(
    "HTTP/1.1 200 OK\r\nLocation: http://192.168.1.30:8008/ssdp/device-desc.xml\r\nST: x\r\n\r\n",
  );
  assert.equal(parseSsdpLocation(msg), "http://192.168.1.30:8008/ssdp/device-desc.xml");
  assert.equal(parseSsdpLocation(Buffer.from("HTTP/1.1 200 OK\r\nLOCATION: file:///etc\r\n")), null);
  assert.deepEqual(
    parseUpnpXml(
      "<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Salón &amp; cocina</friendlyName><manufacturer>LG Electronics</manufacturer><modelName>OLED55</modelName></device></root>",
    ),
    {
      friendlyName: "Salón & cocina",
      manufacturer: "LG Electronics",
      modelName: "OLED55",
      deviceType: "urn:schemas-upnp-org:device:MediaRenderer:1",
    },
  );
});

test("MAC: fabricante por prefijo y dirección privada por el bit local", () => {
  assert.equal(vendorOf("b8:27:eb:11:22:33"), "Raspberry Pi");
  assert.equal(vendorOf("00:00:01:00:00:00"), undefined);
  assert.equal(isRandomMac("ce:16:76:5e:d0:3e"), true);
  assert.equal(isRandomMac("12:15:b8:8d:4b:06"), true);
  assert.equal(isRandomMac("d8:c8:0c:87:d4:a3"), false);
});

test("inferKind: puertos, servicios, modelo, aparato UPnP y fabricante, por ese orden", () => {
  const base = { ports: [], privateMac: false, services: [] };
  assert.equal(inferKind({ ...base, ports: [3389], privateMac: true }), "ordenador");
  assert.equal(inferKind({ ...base, services: ["_ipp._tcp"] }), "impresora");
  assert.equal(inferKind({ ...base, services: ["_googlecast._tcp"] }), "tele");
  assert.equal(inferKind({ ...base, model: "iPhone15,2" }), "movil");
  assert.equal(inferKind({ ...base, model: "MacBookPro18,1", services: ["_companion-link._tcp"] }), "ordenador");
  assert.equal(inferKind({ ...base, upnp: { deviceType: "urn:x:device:InternetGatewayDevice:1" } }), "otro");
  assert.equal(inferKind({ ...base, privateMac: true }), "movil");
  assert.equal(inferKind({ ...base, vendor: "Epson" }), "impresora");
  assert.equal(inferKind(base), "desconocido");
});

test("identifyHosts: junta NetBIOS, mDNS y SSDP de cada equipo e ignora a los que no se preguntó", async () => {
  const sent: string[] = [];
  const udp: UdpExchange = async (sends) => {
    const out = [];
    for (const s of sends) {
      sent.push(`${s.host}:${s.port}`);
      if (s.port === 137 && s.host === "192.168.1.10")
        out.push({ from: s.host, msg: nbstatReply([["OFICINA", 0, false]]) });
      if (s.host === "224.0.0.251" && s.payload.includes(Buffer.from("_services")))
        out.push(
          {
            from: "192.168.1.20",
            msg: dnsReply([rr("_services._dns-sd._udp.local", 12, dnsName("_googlecast._tcp.local"))]),
          },
          { from: "192.168.1.99", msg: dnsReply([rr("_services._dns-sd._udp.local", 12, dnsName("_ipp._tcp.local"))]) },
        );
      if (s.host === "224.0.0.251" && s.payload.includes(Buffer.from("_googlecast")))
        out.push({
          from: "192.168.1.20",
          msg: dnsReply([rr("a._googlecast._tcp.local", 16, txt("fn=Tele", "md=Chromecast"))]),
        });
      if (s.host === "192.168.1.30" && s.port === 5353)
        out.push({ from: s.host, msg: dnsReply([rr(reverseName("192.168.1.30"), 12, dnsName("iPad-de-Leo.local"))]) });
      if (s.port === 1900)
        out.push(
          {
            from: "192.168.1.40",
            msg: Buffer.from("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.40:80/d.xml\r\n\r\n"),
          },
          { from: "192.168.1.41", msg: Buffer.from("HTTP/1.1 200 OK\r\nLOCATION: http://evil.example/d.xml\r\n\r\n") },
        );
    }
    return out;
  };
  const fetched: string[] = [];
  const fetchText = async (url: string) => {
    fetched.push(url);
    return "<device><deviceType>urn:x:device:MediaRenderer:1</deviceType><friendlyName>[TV] Salón</friendlyName><manufacturer>Samsung Electronics</manufacturer><modelName>QE55</modelName></device>";
  };
  const t0 = Date.now();
  const ids = await identifyHosts({
    hosts: ["10", "20", "30", "40", "41", "50"].map((n) => ({
      ip: `192.168.1.${n}`,
      mac: n === "50" ? "ce:16:76:5e:d0:3e" : n === "10" ? "00:14:22:00:00:01" : undefined,
      ports: n === "10" ? [445] : [],
    })),
    udp,
    fetchText,
    budgetMs: 1500,
  });
  assert.ok(Date.now() - t0 < 1500);
  assert.ok(sent.includes("192.168.1.10:137") && sent.includes("239.255.255.250:1900"));
  assert.deepEqual(fetched, ["http://192.168.1.40:80/d.xml"], "nunca una LOCATION de otro servidor");
  const pick = (ip: string) => ids.get(ip);
  assert.deepEqual(pick("192.168.1.10"), {
    name: "OFICINA",
    vendor: "Dell",
    model: undefined,
    kind: "ordenador",
    privateMac: false,
  });
  assert.equal(pick("192.168.1.20")?.name, "Tele");
  assert.equal(pick("192.168.1.20")?.kind, "tele");
  assert.equal(pick("192.168.1.30")?.name, "iPad-de-Leo");
  assert.equal(pick("192.168.1.30")?.ownName, true);
  assert.equal(pick("192.168.1.30")?.kind, "movil");
  assert.deepEqual(pick("192.168.1.40"), {
    name: "[TV] Salón",
    vendor: "Samsung",
    model: "QE55",
    kind: "tele",
    privateMac: false,
  });
  assert.equal(pick("192.168.1.41")?.name, undefined);
  assert.deepEqual(pick("192.168.1.50"), {
    name: undefined,
    vendor: undefined,
    model: undefined,
    kind: "movil",
    privateMac: true,
  });
  assert.ok(!ids.has("192.168.1.99"));
});

test("identifyHosts: respeta el tope aunque la red no conteste nunca", async () => {
  const t0 = Date.now();
  const ids = await identifyHosts({
    hosts: [{ ip: "192.168.1.5", ports: [] }],
    udp: () => new Promise(() => {}),
    fetchText: async () => null,
    budgetMs: 300,
  });
  const ms = Date.now() - t0;
  assert.ok(ms >= 250 && ms < 800, `tardó ${ms} ms`);
  assert.equal(ids.get("192.168.1.5")?.kind, "desconocido");
});
