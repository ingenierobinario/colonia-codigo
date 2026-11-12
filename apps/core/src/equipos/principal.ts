// El lado del Colonia principal: acepta las conexiones de los equipos (ellos marcan, nunca al revés), empareja con el
// código y deja que los agentes pidan trabajo a un equipo solo si el dueño lo activó. Cada petición queda en la auditoría.
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { FILE_PAYLOAD_BYTES } from "@colonia/protocol";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { Store } from "../domain/store.ts";
import { notFound, unauthorized, unavailable } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import {
  createOpener,
  createSealer,
  deriveKeys,
  fingerprintOf,
  generateIdentity,
  type Identity,
  newEphemeral,
  newNonce,
  pairProof,
  sameProof,
  signAs,
  transcript,
  verifyAs,
} from "./channel.ts";
import { createPairing, type Pairing } from "./pairing.ts";
import {
  ClientHello,
  EQUIPO_PATH,
  type Op,
  type Result,
  Sealed,
  type ToEquipo,
  ToPrincipal,
  type Who,
} from "./wire.ts";

const IDENTITY_SECRET = "equipos.identidad";
const INSTALL_BASE = "https://colonia.ingenierobinario.com";
/** Cuánto espera el principal a que el equipo responda (incluye esperar la aprobación de su dueño). */
const DEFAULT_REQUEST_MS = 150_000;
const HANDSHAKE_MS = 15_000;

type Pending = { resolve: (r: Result) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type Live = { send: (m: ToEquipo) => void; close: () => void; pending: Map<string, Pending> };

export type PrincipalDeps = {
  store: Store;
  secrets: Secrets;
  log: Log;
  /** Direcciones por las que otro equipo llega a este Colonia (según el modo de acceso). */
  addresses: () => string[];
  pairing?: Pairing;
  requestMs?: number;
};

const summary = (op: Op) =>
  op.op === "run" ? `ejecutar: ${op.command}` : op.op === "read" ? `leer: ${op.path}` : `subir: ${op.path}`;

export function createPrincipal(d: PrincipalDeps) {
  const pairing = d.pairing ?? createPairing();
  const live = new Map<string, Live>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: FILE_PAYLOAD_BYTES * 2 });

  const identity = (): Identity => {
    const saved = d.secrets.resolve(`secret://${IDENTITY_SECRET}`);
    if (saved) {
      try {
        return JSON.parse(saved) as Identity;
      } catch {}
    }
    const fresh = generateIdentity();
    d.secrets.set(IDENTITY_SECRET, JSON.stringify(fresh));
    return fresh;
  };
  const audit = (kind: string, detail: string, id?: string) => d.store.team.log(kind, detail, id);

  function revoke(id: string, by: "panel" | "equipo"): boolean {
    const ok = d.store.team.revoke(id);
    const l = live.get(id);
    if (l) {
      live.delete(id);
      l.send({ t: "revoked" });
      for (const p of l.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("acceso revocado"));
      }
      setTimeout(() => l.close(), 200).unref();
    }
    if (ok)
      audit(
        "revocado",
        by === "panel" ? "el dueño lo desconectó desde Colonia" : "el dueño lo desconectó desde el propio equipo",
        id,
      );
    return ok;
  }

  function handle(ws: WebSocket) {
    const me = identity();
    let phase: "hello" | "pair" | "auth" | "ready" | "dead" = "hello";
    let seal: ((b: Buffer) => string) | undefined;
    let open: ((s: string) => Buffer) | undefined;
    let tr: Buffer | undefined;
    let computerId: string | undefined;
    const plain = (m: object) => ws.send(JSON.stringify(m));
    const secret = (m: ToEquipo) => {
      if (seal && ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ t: "x", d: seal(Buffer.from(JSON.stringify(m))) }));
    };
    const end = (why?: string) => {
      phase = "dead";
      if (why) plain({ t: "refused", why });
      ws.close(1008, "cerrado");
    };
    const timer = setTimeout(() => phase !== "ready" && end(), HANDSHAKE_MS);
    const entry: Live = { send: secret, close: () => ws.close(1000, "cerrada"), pending: new Map() };

    ws.on("close", () => {
      clearTimeout(timer);
      if (computerId && live.get(computerId) === entry) {
        live.delete(computerId);
        for (const p of entry.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("el equipo se desconectó"));
        }
        audit("desconectado", "el equipo cerró la conexión", computerId);
      }
    });

    ws.on("message", (raw: RawData) => {
      try {
        const text = String(raw);
        if (phase === "hello") {
          const h = ClientHello.parse(JSON.parse(text));
          if (h.mode === "session") {
            const c = h.id ? d.store.team.get(h.id) : undefined;
            if (!c) return end("equipo desconocido o revocado");
            computerId = c.id;
          }
          const eph = newEphemeral();
          const nonce = newNonce();
          tr = transcript(h.mode, h.eph, h.nonce, eph.pub, nonce);
          const keys = deriveKeys(eph, h.eph, tr, "server");
          seal = createSealer(keys.send);
          open = createOpener(keys.receive);
          plain({ t: "hello", eph: eph.pub, nonce, pub: me.publicKey, sig: signAs("principal", tr, me.privateKey) });
          phase = h.mode === "pair" ? "pair" : "auth";
          return;
        }
        const sealed = Sealed.parse(JSON.parse(text));
        if (!open) return end();
        const msg = ToPrincipal.parse(JSON.parse(open(sealed.d).toString()));
        if (phase === "pair" && msg.t === "pair" && tr) {
          const transcriptNow = tr;
          if (!verifyAs("equipo", transcriptNow, msg.sig, msg.pub)) return end("firma no válida");
          const result = pairing.attempt((code) => sameProof(msg.proof, pairProof(code, transcriptNow, msg.pub)));
          if (result !== "ok") {
            audit("emparejamiento_rechazado", `${msg.name}: ${result}`);
            secret({ t: "refused", why: result });
            return end();
          }
          // El código vale y lo escribió el dueño en el propio equipo: ahora sí se da de alta.
          const c = d.store.team.add(msg.name, msg.platform, msg.pub);
          audit("emparejado", `${c.name} (${c.platform}) confirmó el código en el propio equipo`, c.id);
          secret({ t: "paired", id: c.id });
          phase = "dead";
          setTimeout(() => ws.close(1000, "emparejado"), 200).unref();
          return;
        }
        if (phase === "auth" && msg.t === "auth" && tr && computerId) {
          const c = d.store.team.get(computerId);
          if (!c || !verifyAs("equipo", tr, msg.sig, c.public_key)) return end("firma no válida");
          live.get(computerId)?.close();
          live.set(computerId, entry);
          phase = "ready";
          d.store.team.seen(computerId);
          audit("conectado", "el equipo se conectó", computerId);
          secret({ t: "ready" });
          return;
        }
        if (phase === "ready" && computerId) {
          if (msg.t === "revoke") {
            revoke(computerId, "equipo");
            return;
          }
          if (msg.t === "res") {
            const p = entry.pending.get(msg.id);
            if (!p) return;
            entry.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.ok && msg.result) p.resolve(msg.result);
            else p.reject(new Error(msg.error ?? "el equipo no pudo hacerlo"));
            return;
          }
        }
        end();
      } catch (e) {
        d.log.warn({ err: String(e) }, "conexión de equipo rechazada");
        end();
      }
    });
  }

  return {
    pairing,
    path: EQUIPO_PATH,
    fingerprint: () => fingerprintOf(identity().publicKey),
    /** El enganche del servidor HTTP: la ruta del equipo. Sin cabecera Origin: no es un navegador. */
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      if (req.headers.origin) return void socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => handle(ws));
    },
    pairStart() {
      const { code, expiresAt } = pairing.start();
      const urls = d.addresses();
      const fp = fingerprintOf(identity().publicKey);
      const base = urls[0];
      const windows = base
        ? `& ([scriptblock]::Create((irm ${INSTALL_BASE}/install.ps1))) -Equipo ${base} -Huella ${fp}`
        : "";
      const unix = base ? `curl -fsSL ${INSTALL_BASE}/install.sh | sh -s -- --equipo ${base} --huella ${fp}` : "";
      audit("codigo_creado", "se generó un código de emparejamiento");
      return {
        code,
        expires_at: new Date(expiresAt).toISOString(),
        fingerprint: fp,
        urls,
        commands: { windows, unix },
      };
    },
    pairCancel: () => pairing.cancel(),
    connected: (id: string) => live.has(id),
    inUse: (id: string) => (live.get(id)?.pending.size ?? 0) > 0,
    revoke,
    /** Un agente pide algo al equipo: solo con el acceso activado, y todo queda en la auditoría. */
    async request(id: string, op: Op, who: Who): Promise<Result> {
      const c = d.store.team.get(id);
      if (!c) throw notFound("equipo");
      if (!c.agent_access) throw unauthorized(`el acceso de los agentes a «${c.name}» está desactivado`);
      const l = live.get(id);
      if (!l) throw unavailable(`«${c.name}» no está conectado ahora mismo`);
      const reqId = randomUUID();
      audit("peticion", `${who.name}: ${summary(op)}`, id);
      try {
        const result = await new Promise<Result>((resolve, reject) => {
          const timer = setTimeout(() => {
            l.pending.delete(reqId);
            reject(new Error("el equipo no respondió a tiempo (¿nadie aprobó el acceso en él?)"));
          }, d.requestMs ?? DEFAULT_REQUEST_MS);
          l.pending.set(reqId, { resolve, reject, timer });
          l.send({ t: "req", id: reqId, who, op });
        });
        audit("hecho", `${summary(op)}: correcto`, id);
        return result;
      } catch (e) {
        audit("fallo", `${summary(op)}: ${(e as Error).message}`, id);
        throw unavailable((e as Error).message);
      }
    },
    close() {
      for (const l of live.values()) l.close();
      wss.close();
    },
  };
}
export type Principal = ReturnType<typeof createPrincipal>;
