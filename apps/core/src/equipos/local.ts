// ESTE-EQUIPO-1 · El ordenador donde corre Colonia. Los agentes ya trabajan en él, así que en «Mis equipos» sale el
// primero, sin conectarlo: aquí solo se lee su nombre y con qué direcciones se le ve en la red.
import os from "node:os";

export type ThisComputer = { hostname: string; platform: string; addresses: string[] };

/** Las de casa u oficina primero, luego el resto (una VPN); las que no sirven para llegar a él no se enseñan. */
const rank = (ip: string): number => {
  if (ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 0;
  if (ip.startsWith("169.254.")) return 2;
  return 1;
};

export function thisComputer(
  d: {
    hostname?: () => string;
    interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
    platform?: string;
  } = {},
): ThisComputer {
  const ifaces = (d.interfaces ?? os.networkInterfaces)();
  const found = Object.values(ifaces)
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address)
    .filter((ip) => rank(ip) < 2);
  const addresses = [...new Set(found)].sort((a, b) => rank(a) - rank(b));
  return { hostname: (d.hostname ?? os.hostname)(), platform: d.platform ?? process.platform, addresses };
}
