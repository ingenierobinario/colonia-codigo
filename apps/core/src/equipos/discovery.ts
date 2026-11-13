// EQUIPOS-SIN-AGENTE-1 · Descubrimiento de equipos en la red sin instalar nada en ellos: tabla ARP, Tailscale y un
// sondeo corto de puertos para adivinar qué es cada equipo. Las funciones de parseo son puras; probePorts abre sockets.
// EQUIPOS-RED-3 · La caché ARP sola no ve los equipos con los que este ordenador no ha hablado: antes se barre la subred
// local (sondeo TCP corto, que además obliga al sistema a resolver ARP) y los equipos vivos sin puertos remotos ya no se
// descartan: salen como «sin acceso remoto» para que el panel explique qué activar en ellos.
import { promises as dnsPromises } from "node:dns";
import net from "node:net";
import os from "node:os";

export type Platform = "windows" | "linux" | "darwin";
export interface ArpEntry {
  ip: string;
  mac: string;
}
export interface TailscalePeer {
  name: string;
  ip: string;
  os: string;
  online: boolean;
}
export type GuessedOs = "windows" | "linux/mac" | "desconocido";

/** Puertos de referencia y lo que significan para el usuario. */
export const REFERENCE_PORTS: Record<number, string> = {
  22: "Terminal",
  3389: "Escritorio remoto",
  445: "Carpetas",
  5900: "VNC",
};

/** EQUIPOS-RED-3: puertos que se tocan en el barrido. Sólo sirven para saber si hay alguien (abierto o rechazado). */
export const SWEEP_PORTS = [22, 445, 3389, 5900, 135, 139, 80, 443, 5357];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function validIpv4(ip: string): boolean {
  const m = IPV4.exec(ip);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/** Normaliza a «aa:bb:cc:dd:ee:ff» o null si no es una MAC útil (incompleta, difusión, multicast). */
function normalizeMac(raw: string): string | null {
  const parts = raw.trim().toLowerCase().split(/[-:]/);
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-f]{1,2}$/.test(p))) return null;
  const mac = parts.map((p) => p.padStart(2, "0")).join(":");
  if (mac === "ff:ff:ff:ff:ff:ff" || mac === "00:00:00:00:00:00") return null;
  if (mac.startsWith("01:00:5e")) return null;
  return mac;
}

export function parseArp(text: string, platform: Platform): ArpEntry[] {
  const out: ArpEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    let ip: string | undefined;
    let mac: string | undefined;
    if (platform === "windows") {
      const m = /^\s*(\S+)\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s+\S+/.exec(line);
      if (m) [ip, mac] = [m[1], m[2]];
    } else {
      // arp -an / mac arp -a: «? (192.168.1.1) at aa:bb:... on en0»
      const a = /\((\S+)\)\s+at\s+(\S+)/.exec(line);
      // ip neigh: «192.168.1.1 dev eth0 lladdr aa:bb:... REACHABLE»
      const b = /^\s*(\S+)\s+dev\s+\S+\s+lladdr\s+(\S+)/.exec(line);
      const m = a ?? b;
      if (m) [ip, mac] = [m[1], m[2]];
    }
    if (!ip || !mac || !validIpv4(ip)) continue;
    const norm = normalizeMac(mac);
    if (!norm || seen.has(ip)) continue;
    seen.add(ip);
    out.push({ ip, mac: norm });
  }
  return out;
}

interface TsNode {
  HostName?: unknown;
  TailscaleIPs?: unknown;
  OS?: unknown;
  Online?: unknown;
}

function toPeer(n: TsNode): TailscalePeer | null {
  const ips = Array.isArray(n.TailscaleIPs) ? n.TailscaleIPs : [];
  const ip =
    ips.find((x): x is string => typeof x === "string" && validIpv4(x)) ?? (typeof ips[0] === "string" ? ips[0] : "");
  if (typeof n.HostName !== "string" || !ip) return null;
  return { name: n.HostName, ip, os: typeof n.OS === "string" ? n.OS : "", online: n.Online === true };
}

export function parseTailscaleStatus(json: string, opts: { includeSelf?: boolean } = {}): TailscalePeer[] {
  let data: { Self?: TsNode; Peer?: Record<string, TsNode> };
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const nodes: TsNode[] = [];
  if (opts.includeSelf && data.Self && typeof data.Self === "object") nodes.push(data.Self);
  if (data.Peer && typeof data.Peer === "object") nodes.push(...Object.values(data.Peer));
  return nodes.map(toPeer).filter((p): p is TailscalePeer => p !== null);
}

type PortState = "open" | "refused" | "silent";

function probeOneState(ip: string, port: number, timeoutMs: number): Promise<PortState> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    const done = (st: PortState) => {
      sock.destroy();
      resolve(st);
    };
    sock.setTimeout(timeoutMs, () => done("silent"));
    sock.once("connect", () => done("open"));
    // Un «connection refused» (RST) también demuestra que el equipo está encendido.
    sock.once("error", (e: NodeJS.ErrnoException) => done(e.code === "ECONNREFUSED" ? "refused" : "silent"));
  });
}

/** Intenta conectar por TCP a cada puerto en paralelo y devuelve los abiertos, en el orden pedido. */
export async function probePorts(
  ip: string,
  ports: number[] = Object.keys(REFERENCE_PORTS).map(Number),
  timeoutMs = 400,
): Promise<number[]> {
  const res = await Promise.all(ports.map((p) => probeOneState(ip, p, timeoutMs)));
  return ports.filter((_, i) => res[i] === "open");
}

/** EQUIPOS-RED-3: si el equipo respondió algo (abierto o rechazado) y qué puertos tiene abiertos. */
export interface HostProbe {
  alive: boolean;
  open: number[];
}
export type ProbeHost = (ip: string, ports: number[], timeoutMs: number) => Promise<HostProbe>;

export const probeHost: ProbeHost = async (ip, ports, timeoutMs) => {
  const res = await Promise.all(ports.map((p) => probeOneState(ip, p, timeoutMs)));
  return { alive: res.some((r) => r !== "silent"), open: ports.filter((_, i) => res[i] === "open") };
};

export function guessOs(openPorts: number[], _hostname?: string): GuessedOs {
  if ([3389, 445, 135, 139, 5357].some((p) => openPorts.includes(p))) return "windows";
  if (openPorts.includes(22)) return "linux/mac";
  return "desconocido";
}

/** Lo que el panel enseña de cada equipo encontrado. `opens` son las etiquetas de REFERENCE_PORTS con puerto abierto. */
export interface FoundEquipo {
  name: string;
  ip: string;
  os: GuessedOs;
  via: "red" | "tailscale";
  online: boolean;
  ports: number[];
  opens: string[];
}

/** Ejecuta un programa y devuelve su salida, o null si no existe o falla. Inyectable para las pruebas. */
export type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<string | null>;

export const systemExec: Exec = async (cmd, args, timeoutMs) => {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : String(stdout)),
    );
  });
};

const osFromTailscale = (os: string): GuessedOs =>
  /windows/i.test(os) ? "windows" : /linux|macos|darwin|ios|android/i.test(os) ? "linux/mac" : "desconocido";

// ---------------------------------------------------------------------------------------------------------------------
// EQUIPOS-RED-3 · Barrido de la red local

type Ifaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

/** Adaptadores que no son la red de casa u oficina: Hyper-V, WSL, Docker, máquinas virtuales, VPN. */
const VIRTUAL_IFACE =
  /vethernet|wsl|docker|^br-|^veth|virbr|vmware|virtualbox|vboxnet|hyper-?v|tailscale|zerotier|^utun|^tun|^tap|tunnelbear|wireguard|^wg\d|^lo/i;

const toInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

function isPrivate(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export interface LocalSubnet {
  /** Dirección de este ordenador en esa red. */
  address: string;
  /** Primera y última dirección de equipo que se barren (sin red ni difusión). */
  first: string;
  last: string;
}

/**
 * Las redes IPv4 privadas de los adaptadores reales de este ordenador, con su máscara de verdad pero nunca más
 * grandes que un /24 (254 equipos): en una red mayor se barre el /24 donde está este ordenador.
 */
export function localSubnets(ifaces: Ifaces): LocalSubnet[] {
  const out: LocalSubnet[] = [];
  const seen = new Set<string>();
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal || !validIpv4(i.address) || !isPrivate(i.address)) continue;
      const bits = Math.max(24, Math.min(30, maskBits(i.netmask)));
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      const net0 = (toInt(i.address) & mask) >>> 0;
      const bcast = (net0 | (~mask >>> 0)) >>> 0;
      const key = `${net0}/${bits}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address: i.address, first: toIp(net0 + 1), last: toIp(bcast - 1) });
    }
  }
  return out;
}

function maskBits(mask: string): number {
  if (!validIpv4(mask)) return 24;
  let n = toInt(mask);
  let bits = 0;
  while (n & 0x80000000) {
    bits++;
    n = (n << 1) >>> 0;
  }
  return bits;
}

export function hostsOf(s: LocalSubnet): string[] {
  const out: string[] = [];
  for (let n = toInt(s.first); n <= toInt(s.last); n++) out.push(toIp(n));
  return out;
}

const ipInSubnet = (ip: string, s: LocalSubnet) => toInt(ip) >= toInt(s.first) && toInt(ip) <= toInt(s.last);

/** Puertas de enlace por defecto: `route print` (Windows), `ip route` (Linux) o `netstat -rn` (mac). */
export function parseGateways(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m: RegExpExecArray | null =
      /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s/.exec(line) ??
      /^\s*default\s+via\s+(\d+\.\d+\.\d+\.\d+)/.exec(line) ??
      /^\s*default\s+(\d+\.\d+\.\d+\.\d+)\s/.exec(line);
    const gw = m?.[1];
    if (gw && validIpv4(gw)) out.add(gw);
  }
  return [...out];
}

/** Nombre NetBIOS de `nbtstat -A`: la primera fila «NOMBRE <00> UNIQUE». */
export function parseNbtstat(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^\s<][^<]*?)\s*<00>\s+UNI/i.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/** Ejecuta `fn` sobre cada elemento con como mucho `limit` a la vez. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref?.())]);

export type ResolveName = (ip: string) => Promise<string | null>;

/** DNS inverso / resolución del sistema (en Windows incluye NetBIOS y LLMNR), y si no, `nbtstat -A` en Windows. */
export function systemResolveName(exec: Exec, plat: NodeJS.Platform): ResolveName {
  const clean = (ip: string, n: string | null) =>
    n && n !== ip && !validIpv4(n) ? n.replace(/\.(local|lan|home)$/i, "") : null;
  return async (ip) => {
    // Las tres vías a la vez y con un tope de 2 s en total: la que tenga nombre gana, por este orden.
    const [viaOs, rev, nb] = await Promise.all([
      withTimeout(
        dnsPromises.lookupService(ip, 0).then((r) => r.hostname),
        2000,
        null as string | null,
      ),
      withTimeout(
        dnsPromises.reverse(ip).then((r) => r[0] ?? null),
        2000,
        null as string | null,
      ),
      plat === "win32"
        ? withTimeout(
            exec("nbtstat", ["-A", ip], 2000).then((t) => (t ? parseNbtstat(t) : null)),
            2000,
            null as string | null,
          )
        : null,
    ]);
    return clean(ip, viaOs) ?? clean(ip, rev) ?? clean(ip, nb);
  };
}

/**
 * Busca equipos: barre la red local (EQUIPOS-RED-3), lee la tabla ARP de este ordenador, `tailscale status --json` si
 * existe, y a cada uno le sondea los puertos de referencia en paralelo con timeouts cortos. Un equipo vivo sin ningún
 * puerto útil abierto sale con `ports` vacío («sin acceso remoto»); se excluyen la puerta de enlace y este ordenador.
 */
export async function discoverEquipos(
  d: {
    exec?: Exec;
    probe?: ProbeHost;
    platform?: NodeJS.Platform;
    probeMs?: number;
    interfaces?: Ifaces;
    resolveName?: ResolveName;
    concurrency?: number;
  } = {},
): Promise<{ equipos: FoundEquipo[]; tailscale: boolean }> {
  const exec = d.exec ?? systemExec;
  const probe = d.probe ?? probeHost;
  const plat = d.platform ?? process.platform;
  const probeMs = d.probeMs ?? 500;
  const ifaces = d.interfaces ?? os.networkInterfaces();
  const resolveName = d.resolveName ?? systemResolveName(exec, plat);
  const arpPlatform: Platform = plat === "win32" ? "windows" : plat === "darwin" ? "darwin" : "linux";
  const subnets = localSubnets(ifaces);
  const self = new Set(
    Object.values(ifaces)
      .flat()
      .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4")
      .map((i) => i.address),
  );
  const routeCmd: [string, string[]] =
    plat === "win32"
      ? ["route", ["print", "-4", "0.0.0.0"]]
      : plat === "darwin"
        ? ["netstat", ["-rn", "-f", "inet"]]
        : ["ip", ["route", "show", "default"]];
  const readArp = async () => {
    const [a, n] = await Promise.all([
      exec("arp", ["-a"], 3000),
      plat === "linux" ? exec("ip", ["neigh"], 3000) : Promise.resolve(null),
    ]);
    return [...parseArp(a ?? "", arpPlatform), ...parseArp(n ?? "", arpPlatform)];
  };

  // 1) Barrido: cada equipo de la subred recibe un toque TCP en los puertos comunes. Además de lo que contesten, el
  //    sistema tiene que resolver su MAC, así que la tabla ARP se llena aunque el cortafuegos se calle.
  const [tsText, routeText, sweep] = await Promise.all([
    exec("tailscale", ["status", "--json"], 3000),
    exec(routeCmd[0], routeCmd[1], 3000),
    (async () => {
      const targets = subnets.flatMap(hostsOf).filter((ip) => !self.has(ip));
      const res = await pool(targets, d.concurrency ?? 64, (ip) => probe(ip, SWEEP_PORTS, probeMs));
      return new Map(targets.map((ip, i) => [ip, res[i] as HostProbe]));
    })(),
  ]);
  const gateways = new Set(parseGateways(routeText ?? ""));
  // 2) Releer ARP, ya poblada por el barrido. Si hay redes conocidas, sólo cuentan las de esas redes (no Hyper-V…).
  const arp = (await readArp()).filter((a) => subnets.length === 0 || subnets.some((s) => ipInSubnet(a.ip, s)));
  const peers = tsText ? parseTailscaleStatus(tsText) : [];
  const ports = Object.keys(REFERENCE_PORTS).map(Number);
  const candidates = new Map<string, { name: string; via: FoundEquipo["via"]; online: boolean; tsOs?: string }>();
  for (const p of peers) candidates.set(p.ip, { name: p.name, via: "tailscale", online: p.online, tsOs: p.os });
  const lan = new Set<string>(arp.map((a) => a.ip));
  for (const [ip, r] of sweep) if (r.alive) lan.add(ip);
  for (const ip of lan) {
    if (self.has(ip) || gateways.has(ip) || candidates.has(ip)) continue;
    candidates.set(ip, { name: ip, via: "red", online: true });
  }
  const found = await Promise.all(
    [...candidates].map(async ([ip, c]): Promise<FoundEquipo> => {
      const swept = sweep.get(ip);
      const all = !c.online ? [] : swept ? swept.open : (await probe(ip, ports, probeMs)).open;
      const open = all.filter((p) => ports.includes(p));
      const name = c.via === "red" ? ((await resolveName(ip)) ?? ip) : c.name;
      const os = all.length ? guessOs(all) : c.tsOs ? osFromTailscale(c.tsOs) : "desconocido";
      return {
        name,
        ip,
        os,
        via: c.via,
        online: c.online,
        ports: open,
        opens: open.map((p) => REFERENCE_PORTS[p] ?? String(p)),
      };
    }),
  );
  const order = (e: FoundEquipo) => (e.via === "tailscale" ? 0 : 1) * 2 ** 32 + (e.via === "red" ? toInt(e.ip) : 0);
  return { equipos: found.sort((a, b) => order(a) - order(b)), tailscale: tsText !== null };
}
