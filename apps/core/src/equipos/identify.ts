// EQUIPOS-NOMBRE-1 · Identificar los equipos de la red que no dan nombre por DNS: NetBIOS por UDP 137 (sin nbtstat),
// mDNS/DNS-SD en 224.0.0.251:5353, SSDP/UPnP en 239.255.255.250:1900 y el fabricante por el prefijo de la MAC. Todo a
// la vez y con un tope total. Los constructores y lectores de paquetes son puros; el envío UDP y el HTTP se inyectan.

export type DeviceKind = "ordenador" | "movil" | "tele" | "impresora" | "otro" | "desconocido";

export interface Identity {
  /** Nombre del equipo si alguno de los protocolos lo dio. */
  name?: string;
  /** El nombre lo puso su dueño (Bonjour/mDNS o Chromecast): manda sobre el NetBIOS o el DNS del router. */
  ownName?: boolean;
  vendor?: string;
  model?: string;
  kind: DeviceKind;
  /** La MAC es aleatoria (bit de administración local): móvil o tableta con dirección privada. */
  privateMac: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fabricante por MAC

/** Prefijos OUI de los fabricantes más comunes en casa y oficina. Tabla pequeña a propósito: lo que no esté, no se nombra. */
const OUI: Record<string, string> = {};
const add = (vendor: string, prefixes: string) => {
  for (const p of prefixes.split(/\s+/).filter(Boolean)) OUI[p] = vendor;
};
add("Apple", "000393 000a95 0017f2 001b63 001ec2 002500 28cfe9 3c0754 7cc3a1 a45e60 acbc32 f01898 d023db");
add("Samsung", "0012fb 001599 001632 001d25 5c0a5b 8c7712 f025b7 78bdbc cc07ab");
add("Raspberry Pi", "b827eb dca632 e45f01 d83add 28cdc1 2ccf67");
add("Google", "f4f5d8 f4f5e8 546009 3c5ab4 a47733 1cf29a 48d6d5");
add("Amazon", "74c246 44650d f0272d 6837e9 fc65de 84d6d0");
add("Sony", "001dba 0024be fcf152 0013a9");
add("LG", "001c62 001e75 10683f a823fe c808e9");
add("Xiaomi", "640980 286c07 f8a45f 508f4c 34ce00 7811dc");
add("Huawei", "00e0fc 001882 00259e 286ed4 4846fb 00464b");
add("HP", "001b78 00215a 3cd92b 000bcd 9c8e99 ecb1d7 0017a4");
add("Dell", "001422 001e4f 180373 f8b156 b8ac6f d4bed9 002170");
add("Lenovo", "507b9d 98fa9b");
add("Intel", "001b21 001e67 3ca9f4 a0369f 8c8d28 7c7a91 001517");
add("TP-Link", "50c7bf 14cc20 98dac4 ec086b c04a00 f4ec38 60e327");
add("Microsoft", "281878 7c1e52");
add("Synology", "001132");
add("Brother", "008077");
add("Canon", "001e8f");
add("Epson", "0026ab 64eb8c");
add("Sonos", "000e58");

/** Bit «administrada localmente» del primer octeto: la usan los móviles y tabletas con dirección privada. */
export function isRandomMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

export function vendorOf(mac: string): string | undefined {
  return OUI[
    mac
      .replace(/[^0-9a-f]/gi, "")
      .toLowerCase()
      .slice(0, 6)
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// NetBIOS (Node Status Request, RFC 1002 §4.2.17)

export function buildNbstatQuery(id = 0x4342): Buffer {
  const name = Buffer.alloc(34);
  name[0] = 0x20;
  const raw = Buffer.alloc(16); // «*» y relleno con ceros
  raw[0] = 0x2a;
  for (let i = 0; i < 16; i++) {
    const b = raw[i] as number;
    name[1 + i * 2] = 0x41 + (b >> 4);
    name[2 + i * 2] = 0x41 + (b & 0x0f);
  }
  const head = Buffer.from([id >> 8, id & 255, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([head, name, Buffer.from([0x00, 0x21, 0x00, 0x01])]);
}

/** Primer nombre único con sufijo <00> (el del equipo). null si el paquete no es una respuesta NBSTAT válida. */
export function parseNbstatResponse(msg: Buffer): string | null {
  try {
    if (msg.length < 12 || (msg.readUInt16BE(2) & 0x8000) === 0 || msg.readUInt16BE(6) < 1) return null;
    let off = skipName(msg, 12);
    if (msg.readUInt16BE(off) !== 0x21) return null;
    off += 8; // tipo, clase, ttl
    const rdEnd = off + 2 + msg.readUInt16BE(off);
    off += 2;
    const n = msg[off] as number;
    off += 1;
    for (let i = 0; i < n && off + 18 <= Math.min(rdEnd, msg.length); i++, off += 18) {
      const name = msg.toString("latin1", off, off + 15).replace(/[\s\0]+$/, "");
      const suffix = msg[off + 15];
      const group = (msg.readUInt16BE(off + 16) & 0x8000) !== 0;
      if (suffix === 0 && !group && name && /^[\x21-\x7e][\x20-\x7e]*$/.test(name)) return name;
    }
  } catch {
    // paquete corto
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// DNS (mDNS / DNS-SD)

function encodeName(name: string): Buffer {
  const parts = name.replace(/\.$/, "").split(".");
  return Buffer.concat([
    ...parts.map((p) => {
      const b = Buffer.from(p, "utf8");
      return Buffer.concat([Buffer.from([b.length]), b]);
    }),
    Buffer.from([0]),
  ]);
}

/** Consulta DNS con varias preguntas del mismo tipo (12 = PTR). `qu` pide respuesta unicast (bit alto de la clase). */
export function buildDnsQuery(names: string[], type = 12, qu = true, id = 0): Buffer {
  const head = Buffer.from([id >> 8, id & 255, 0, 0, names.length >> 8, names.length & 255, 0, 0, 0, 0, 0, 0]);
  const qs = names.map((n) => Buffer.concat([encodeName(n), Buffer.from([type >> 8, type & 255, qu ? 0x80 : 0, 1])]));
  return Buffer.concat([head, ...qs]);
}

function skipName(msg: Buffer, off: number): number {
  for (let guard = 0; guard < 128; guard++) {
    const len = msg[off];
    if (len === undefined) throw new RangeError("nombre cortado");
    if (len === 0) return off + 1;
    if ((len & 0xc0) === 0xc0) return off + 2;
    off += 1 + len;
  }
  throw new RangeError("nombre demasiado largo");
}

function readName(msg: Buffer, off: number): string {
  const labels: string[] = [];
  for (let guard = 0; guard < 64; guard++) {
    const len = msg[off];
    if (len === undefined) throw new RangeError("nombre cortado");
    if (len === 0) break;
    if ((len & 0xc0) === 0xc0) {
      off = ((len & 0x3f) << 8) | (msg[off + 1] as number);
      continue;
    }
    labels.push(msg.toString("utf8", off + 1, off + 1 + len));
    off += 1 + len;
  }
  return labels.join(".");
}

export interface DnsRecord {
  name: string;
  type: number;
  /** PTR: el destino. TXT: pares clave=valor. A: la dirección. */
  data: string | Record<string, string>;
}

/** Todas las respuestas y registros adicionales de un mensaje DNS (PTR, TXT, A). Lo demás se salta. */
export function parseDnsRecords(msg: Buffer): DnsRecord[] {
  const out: DnsRecord[] = [];
  try {
    if (msg.length < 12) return out;
    const qd = msg.readUInt16BE(4);
    const rr = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = skipName(msg, off) + 4;
    for (let i = 0; i < rr && off < msg.length; i++) {
      const name = readName(msg, off);
      off = skipName(msg, off);
      const type = msg.readUInt16BE(off);
      const len = msg.readUInt16BE(off + 8);
      const start = off + 10;
      off = start + len;
      if (off > msg.length) break;
      if (type === 12) out.push({ name, type, data: readName(msg, start) });
      else if (type === 1 && len === 4) out.push({ name, type, data: [...msg.subarray(start, start + 4)].join(".") });
      else if (type === 16) {
        const kv: Record<string, string> = {};
        for (let p = start; p < off; ) {
          const l = msg[p] as number;
          const s = msg.toString("utf8", p + 1, p + 1 + l);
          const eq = s.indexOf("=");
          if (eq > 0) kv[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
          p += 1 + l;
        }
        out.push({ name, type, data: kv });
      }
    }
  } catch {
    // paquete corto o mal formado: se queda lo leído
  }
  return out;
}

export const reverseName = (ip: string) => `${ip.split(".").reverse().join(".")}.in-addr.arpa`;

// ---------------------------------------------------------------------------------------------------------------------
// SSDP / UPnP

export const MSEARCH = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n',
);

export function parseSsdpLocation(msg: Buffer): string | null {
  const m = /^location:\s*(\S+)/im.exec(msg.toString("latin1"));
  return m?.[1] && /^https?:\/\//i.test(m[1]) ? m[1] : null;
}

export interface UpnpInfo {
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  deviceType?: string;
}

const xmlUnescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Lee el primer <device> de la descripción UPnP. */
export function parseUpnpXml(xml: string): UpnpInfo {
  const pick = (tag: string) => {
    const m = new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*</(?:\\w+:)?${tag}>`, "i").exec(xml);
    return m?.[1] ? xmlUnescape(m[1]).slice(0, 80) : undefined;
  };
  return {
    friendlyName: pick("friendlyName"),
    manufacturer: pick("manufacturer"),
    modelName: pick("modelName"),
    deviceType: pick("deviceType"),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Inferir el tipo

export interface Signals {
  ports: number[];
  vendor?: string;
  privateMac: boolean;
  services: string[];
  model?: string;
  upnp?: UpnpInfo;
  /** El nombre también delata: «iPad-de-Leo», «MacBook-de-Ana», «[TV] Salón». */
  name?: string;
}

const PRINTER_SVC = /^_(ipps?|printer|pdl-datastream|scanner|uscan)\._tcp/;
const TV_SVC = /^_(googlecast|androidtvremote2?|amzn-wplay|roku|spotify-connect)\._tcp/;
const PC_SVC = /^_(smb|ssh|sftp-ssh|rfb|workstation|afpovertcp|adisk)\._tcp/;
const MOBILE_MODEL = /iphone|ipad|ipod|android|pixel|galaxy|\bsm-[a-z]\d|redmi|oneplus/i;
const PC_MODEL = /macbook|imac|mac ?mini|macpro|mac\d+,\d+|thinkpad|latitude|optiplex|surface|raspberry/i;
const TV_MODEL = /\btv\b|bravia|chromecast|roku|fire ?tv|webos|tizen|apple ?tv|appletv|shield/i;

export function inferKind(s: Signals): DeviceKind {
  const text = [s.model, s.name, s.upnp?.modelName, s.upnp?.friendlyName].filter(Boolean).join(" ");
  const devType = s.upnp?.deviceType ?? "";
  if ([22, 3389, 445, 139, 135, 5900].some((p) => s.ports.includes(p))) return "ordenador";
  if (s.services.some((x) => PC_SVC.test(x)) || PC_MODEL.test(text)) return "ordenador";
  if (s.services.some((x) => PRINTER_SVC.test(x)) || /printer/i.test(devType)) return "impresora";
  if (MOBILE_MODEL.test(text)) return "movil";
  if (s.services.some((x) => TV_SVC.test(x)) || TV_MODEL.test(text) || /mediarenderer/i.test(devType)) return "tele";
  if (/internetgatewaydevice|wlanaccesspoint/i.test(devType)) return "otro";
  if (s.services.some((x) => /^_(companion-link|apple-mobdev2)\._tcp/.test(x))) return "movil";
  if (s.services.some((x) => /^_(airplay|raop)\._tcp/.test(x))) return "tele";
  if (s.privateMac) return "movil";
  switch (s.vendor) {
    case "Brother":
    case "Canon":
    case "Epson":
      return "impresora";
    case "Sony":
    case "LG":
      return "tele";
    case "Amazon":
    case "Google":
    case "Sonos":
    case "TP-Link":
      return "otro";
    case "Xiaomi":
    case "Huawei":
      return "movil";
    case "Raspberry Pi":
    case "Dell":
    case "Lenovo":
    case "Intel":
    case "Microsoft":
    case "Synology":
      return "ordenador";
    default:
      return "desconocido";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Orquestación

export interface UdpReply {
  from: string;
  msg: Buffer;
}
/**
 * Envía cada paquete a su destino desde un mismo socket efímero y devuelve todo lo que llegue durante `waitMs`.
 * `iface` es la dirección local por la que salen los paquetes multicast. Inyectable para las pruebas.
 */
export type UdpExchange = (
  sends: { host: string; port: number; payload: Buffer }[],
  waitMs: number,
  iface?: string,
) => Promise<UdpReply[]>;

export type FetchText = (url: string, timeoutMs: number) => Promise<string | null>;

export const systemUdp: UdpExchange = async (sends, waitMs, iface) => {
  const dgram = await import("node:dgram");
  return new Promise((resolve) => {
    const out: UdpReply[] = [];
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try {
        sock.close();
      } catch {
        // ya cerrado
      }
      resolve(out);
    };
    sock.on("message", (msg, r) => out.push({ from: r.address, msg }));
    sock.on("error", finish);
    sock.bind(0, () => {
      try {
        if (iface) sock.setMulticastInterface(iface);
        sock.setMulticastTTL(2);
      } catch {
        // sin multicast: siguen valiendo los envíos directos
      }
      for (const s of sends) sock.send(s.payload, s.port, s.host, () => {});
      setTimeout(finish, waitMs).unref?.();
    });
  });
};

export const systemFetchText: FetchText = async (url, timeoutMs) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.text()).slice(0, 64 * 1024);
  } catch {
    return null;
  }
};

/** Una dirección de la red local, no un servidor de fuera (la LOCATION de SSDP la manda cualquiera de la red). */
function sameHostUrl(url: string, ip: string): boolean {
  try {
    return new URL(url).hostname === ip;
  } catch {
    return false;
  }
}

const cleanName = (n: string | undefined) => n?.replace(/\.local\.?$/i, "").trim() || undefined;

/**
 * Pregunta a la vez por NetBIOS, mDNS/DNS-SD y SSDP a los equipos dados y les añade el fabricante por MAC.
 * Nunca tarda más de `budgetMs`: lo que no haya contestado a tiempo, no cuenta.
 */
export async function identifyHosts(d: {
  hosts: { ip: string; mac?: string; ports: number[] }[];
  iface?: string;
  udp?: UdpExchange;
  fetchText?: FetchText;
  budgetMs?: number;
}): Promise<Map<string, Identity>> {
  const udp = d.udp ?? systemUdp;
  const fetchText = d.fetchText ?? systemFetchText;
  const budget = d.budgetMs ?? 3000;
  const ips = new Set(d.hosts.map((h) => h.ip));
  const wait = Math.min(1200, Math.max(200, Math.floor(budget * 0.4)));
  const netbios = new Map<string, string>();
  const mdnsName = new Map<string, string>();
  const services = new Map<string, Set<string>>();
  const txt = new Map<string, Record<string, string>>();
  const upnp = new Map<string, UpnpInfo>();
  const hostIps = [...ips];
  if (hostIps.length === 0) return new Map();

  const runNetbios = async () => {
    const q = buildNbstatQuery();
    const res = await udp(
      hostIps.map((host) => ({ host, port: 137, payload: q })),
      wait,
    );
    for (const r of res) {
      const n = ips.has(r.from) ? parseNbstatResponse(r.msg) : null;
      if (n && !netbios.has(r.from)) netbios.set(r.from, n);
    }
  };

  const absorbDns = (r: UdpReply) => {
    if (!ips.has(r.from)) return;
    for (const rec of parseDnsRecords(r.msg)) {
      if (rec.type === 12 && typeof rec.data === "string") {
        if (rec.name.endsWith(".in-addr.arpa") && rec.name === reverseName(r.from)) {
          const n = cleanName(rec.data);
          if (n) mdnsName.set(r.from, n);
        } else if (rec.name === "_services._dns-sd._udp.local") {
          const set = services.get(r.from) ?? new Set<string>();
          services.set(r.from, set);
          set.add(rec.data.replace(/\.local$/, ""));
        }
      } else if (rec.type === 16 && typeof rec.data === "object") {
        // Cada servicio llama distinto a las cosas: «md» es el modelo en Chromecast pero otra cosa en AirPlay (raop).
        const kv = rec.data;
        const cur = txt.get(r.from) ?? {};
        const svc = rec.name.toLowerCase();
        const fn = svc.includes("._googlecast.") ? kv.fn : undefined;
        const model = svc.includes("._googlecast.")
          ? kv.md
          : PRINTER_SVC.test(svc.slice(svc.indexOf("._") + 1))
            ? kv.ty
            : /\._(airplay|device-info)\./.test(svc)
              ? kv.model
              : svc.includes("._raop.")
                ? kv.am
                : undefined;
        txt.set(r.from, { ...(fn ? { fn } : {}), ...(model ? { model } : {}), ...cur });
      }
    }
  };

  const runMdns = async () => {
    const half = Math.max(150, Math.floor(wait * 0.6));
    // 1) Inverso de cada equipo (directo a su 5353 y por multicast) y qué servicios anuncia la red.
    const rev = hostIps.map((ip) => ({ host: ip, port: 5353, payload: buildDnsQuery([reverseName(ip)]) }));
    const multi = [];
    for (let i = 0; i < hostIps.length; i += 20)
      multi.push({
        host: "224.0.0.251",
        port: 5353,
        payload: buildDnsQuery(hostIps.slice(i, i + 20).map(reverseName)),
      });
    multi.push({ host: "224.0.0.251", port: 5353, payload: buildDnsQuery(["_services._dns-sd._udp.local"]) });
    for (const r of await udp([...rev, ...multi], half, d.iface)) absorbDns(r);
    // 2) Por cada tipo de servicio visto, sus instancias: traen el TXT con el nombre (fn) y el modelo (md, model, ty).
    const types = [...new Set([...services.values()].flatMap((s) => [...s]))].slice(0, 30);
    if (types.length === 0) return;
    const q = buildDnsQuery(types.map((t) => `${t}.local`));
    for (const r of await udp([{ host: "224.0.0.251", port: 5353, payload: q }], half, d.iface)) absorbDns(r);
  };

  const runSsdp = async () => {
    const res = await udp([{ host: "239.255.255.250", port: 1900, payload: MSEARCH }], wait, d.iface);
    const locs = new Map<string, string>();
    for (const r of res) {
      const loc = ips.has(r.from) ? parseSsdpLocation(r.msg) : null;
      if (loc && sameHostUrl(loc, r.from) && !locs.has(r.from)) locs.set(r.from, loc);
    }
    const left = Math.max(200, budget - wait - 300);
    await Promise.all(
      [...locs].map(async ([ip, url]) => {
        const xml = await fetchText(url, left);
        if (xml) upnp.set(ip, parseUpnpXml(xml));
      }),
    );
  };

  const all = Promise.all([runNetbios(), runMdns(), runSsdp()].map((p) => p.catch(() => {})));
  await Promise.race([all, new Promise((r) => setTimeout(r, budget).unref?.())]);

  const out = new Map<string, Identity>();
  for (const h of d.hosts) {
    const privateMac = h.mac ? isRandomMac(h.mac) : false;
    const vendorMac = h.mac && !privateMac ? vendorOf(h.mac) : undefined;
    const t = txt.get(h.ip) ?? {};
    const u = upnp.get(h.ip);
    const model = t.model || u?.modelName || undefined;
    const svc = [...(services.get(h.ip) ?? [])];
    // Con la MAC privada no hay fabricante, pero los servicios de Apple y su modelo («Mac15,12», «iPhone…») lo delatan.
    const apple =
      svc.some((x) => /^_(companion-link|apple-mobdev2)\._tcp/.test(x)) ||
      /^(mac|iphone|ipad|appletv)\d/i.test(model ?? "");
    const vendor =
      u?.manufacturer?.replace(/,?\s*(inc|ltd|co|corp|corporation|electronics)\.?$/i, "") ||
      vendorMac ||
      (apple ? "Apple" : undefined);
    // El nombre que puso la persona (Chromecast, Bonjour) antes que el NetBIOS, que en un Mac es «MAC-6BF692».
    const name = cleanName(t.fn) ?? mdnsName.get(h.ip) ?? netbios.get(h.ip) ?? cleanName(u?.friendlyName);
    const kind = inferKind({
      ports: h.ports,
      vendor: vendorMac ?? vendor,
      privateMac,
      services: svc,
      model,
      upnp: u,
      name,
    });
    const ownName = !!(cleanName(t.fn) ?? mdnsName.get(h.ip));
    out.set(h.ip, { name, ...(ownName ? { ownName } : {}), vendor, model, kind, privateMac });
  }
  return out;
}
