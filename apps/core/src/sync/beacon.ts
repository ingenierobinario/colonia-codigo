// D-192 fase 2 · Cómo se encuentran dos equipos en la misma red sin que nadie escriba una dirección: uno pregunta en
// voz alta («¿quién enseña este código?», «¿dónde está mi pareja?») y el otro contesta por dónde se le alcanza. Lo que
// se oye aquí solo son candidatas: quién es quién lo decide después el apretón de manos, no este canal.

import { randomUUID } from "node:crypto";
import dgram from "node:dgram";
import os from "node:os";
import { z } from "zod";

export const BEACON_PORT = 47474;
const GROUP = "239.255.74.74";

const Heard = z.object({
  c: z.literal("colonia-sincronizar"),
  from: z.string().max(64),
  t: z.enum(["busca", "aqui"]),
  tag: z.string().max(64),
  urls: z.array(z.string().max(300)).max(8),
});
export type BeaconMsg = Pick<z.infer<typeof Heard>, "t" | "tag" | "urls">;

const ipv4 = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4");

/** Las direcciones de este mismo equipo: lo que llega desde ellas viene de otro Colonia en esta máquina. */
export const ownAddresses = () => new Set(ipv4().map((i) => i.address));

/** La dirección «a todos» de cada red a la que está enchufado este equipo. */
function broadcasts(): string[] {
  const out = new Set(["255.255.255.255"]);
  for (const i of ipv4()) {
    if (i.internal) continue;
    const ip = i.address.split(".").map(Number);
    const mask = i.netmask.split(".").map(Number);
    if (ip.length === 4 && mask.length === 4)
      out.add(ip.map((b, n) => (b | (~(mask[n] ?? 255) & 255)) & 255).join("."));
  }
  return [...out];
}

export function createBeacon(o: { port?: number; heard(m: BeaconMsg, host: string): void; warn?(msg: string): void }) {
  const port = o.port ?? BEACON_PORT;
  const me = randomUUID();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let closed = false;
  const ready = new Promise<boolean>((resolve) => {
    socket.once("error", (err) => {
      o.warn?.(`no se puede buscar al otro equipo en la red: ${err.message}`);
      resolve(false);
    });
    socket.bind(port, () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastLoopback(true);
        socket.setMulticastTTL(1);
      } catch {}
      try {
        socket.addMembership(GROUP);
      } catch {}
      for (const i of ipv4()) {
        try {
          socket.addMembership(GROUP, i.address);
        } catch {}
      }
      resolve(true);
    });
  });
  socket.on("error", () => {});
  socket.on("message", (raw, from) => {
    if (closed || raw.length > 4096) return;
    try {
      const m = Heard.parse(JSON.parse(String(raw)));
      if (m.from !== me) o.heard({ t: m.t, tag: m.tag, urls: m.urls }, from.address);
    } catch {}
  });
  socket.unref();
  return {
    /** Lo dice a toda la red local (y a los otros Colonias de este mismo equipo). */
    say(m: BeaconMsg): void {
      void ready.then((ok) => {
        if (!ok || closed) return;
        const data = Buffer.from(JSON.stringify({ c: "colonia-sincronizar", from: me, ...m }));
        for (const to of [GROUP, ...broadcasts()]) socket.send(data, port, to, () => {});
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      void ready.then(() => {
        try {
          socket.close();
        } catch {}
      });
    },
  };
}
export type Beacon = ReturnType<typeof createBeacon>;
