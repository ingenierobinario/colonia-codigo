// EQUIPOS-SIN-AGENTE-1 · Descubrimiento de equipos en la red sin instalar nada en ellos: tabla ARP, Tailscale y un
// sondeo corto de puertos para adivinar qué es cada equipo. Las funciones de parseo son puras; probePorts abre sockets.
import net from "node:net";

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
  const ip = ips.find((x): x is string => typeof x === "string" && validIpv4(x)) ?? (typeof ips[0] === "string" ? ips[0] : "");
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

function probeOne(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** Intenta conectar por TCP a cada puerto en paralelo y devuelve los abiertos, en el orden pedido. */
export async function probePorts(
  ip: string,
  ports: number[] = Object.keys(REFERENCE_PORTS).map(Number),
  timeoutMs = 400,
): Promise<number[]> {
  const res = await Promise.all(ports.map((p) => probeOne(ip, p, timeoutMs)));
  return ports.filter((_, i) => res[i]);
}

export function guessOs(openPorts: number[], _hostname?: string): GuessedOs {
  if (openPorts.includes(3389) || openPorts.includes(445)) return "windows";
  if (openPorts.includes(22)) return "linux/mac";
  return "desconocido";
}
