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

/**
 * Busca equipos: tabla ARP de este ordenador + `tailscale status --json` si existe, y a cada uno le sondea los puertos
 * de referencia en paralelo con timeouts cortos. Un equipo sin ningún puerto útil abierto se descarta (router, móvil,
 * tele…), salvo los de Tailscale, que siempre son equipos del dueño.
 */
export async function discoverEquipos(
  d: { exec?: Exec; probe?: typeof probePorts; platform?: NodeJS.Platform; probeMs?: number } = {},
): Promise<{ equipos: FoundEquipo[]; tailscale: boolean }> {
  const exec = d.exec ?? systemExec;
  const probe = d.probe ?? probePorts;
  const plat = d.platform ?? process.platform;
  const arpPlatform: Platform = plat === "win32" ? "windows" : plat === "darwin" ? "darwin" : "linux";
  const [arpText, neighText, tsText] = await Promise.all([
    exec("arp", ["-a"], 3000),
    plat === "linux" ? exec("ip", ["neigh"], 3000) : Promise.resolve(null),
    exec("tailscale", ["status", "--json"], 3000),
  ]);
  const arp = [...parseArp(arpText ?? "", arpPlatform), ...parseArp(neighText ?? "", arpPlatform)];
  const peers = tsText ? parseTailscaleStatus(tsText) : [];
  const ports = Object.keys(REFERENCE_PORTS).map(Number);
  const candidates = new Map<string, { name: string; via: FoundEquipo["via"]; online: boolean; tsOs?: string }>();
  for (const p of peers) candidates.set(p.ip, { name: p.name, via: "tailscale", online: p.online, tsOs: p.os });
  for (const a of arp) if (!candidates.has(a.ip)) candidates.set(a.ip, { name: a.ip, via: "red", online: true });
  const found = await Promise.all(
    [...candidates].map(async ([ip, c]): Promise<FoundEquipo | null> => {
      const open = c.online ? await probe(ip, ports, d.probeMs ?? 400) : [];
      if (c.via === "red" && open.length === 0) return null;
      const os = open.length ? guessOs(open) : c.tsOs ? osFromTailscale(c.tsOs) : "desconocido";
      return {
        name: c.name,
        ip,
        os,
        via: c.via,
        online: c.online,
        ports: open,
        opens: open.map((p) => REFERENCE_PORTS[p] ?? String(p)),
      };
    }),
  );
  return { equipos: found.filter((f): f is FoundEquipo => f !== null), tailscale: tsText !== null };
}
