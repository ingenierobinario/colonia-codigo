// El lado del equipo (el portátil): su propio Colonia marca hacia fuera al principal, se empareja con el código que el
// dueño teclea AQUÍ, y a partir de ahí atiende peticiones, pero solo las que su dueño aprueba (approval.ts).
// La clave privada vive en el almacén del sistema (equipo.clave); en equipo.json solo hay datos públicos.
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import type { Log } from "../log.ts";
import type { Secrets } from "../secrets.ts";
import { type Approval, type EquipoState, readState, writeState } from "./approval.ts";
import {
  createOpener,
  createSealer,
  deriveKeys,
  fingerprintOf,
  generateIdentity,
  newEphemeral,
  newNonce,
  pairProof,
  sameFingerprint,
  signAs,
  transcript,
  verifyAs,
} from "./channel.ts";
import type { KeyStore } from "./keystore.ts";
import type { Notify } from "./notify.ts";
import { type Run, readFile, runCommand, writeFile } from "./ops.ts";
import type { Tray } from "./tray.ts";
import { EQUIPO_PATH, type Op, Plain, type Result, Sealed, ServerHello, ToEquipo } from "./wire.ts";

const HANDSHAKE_MS = 15_000;

export type AuditLine = { at: string; kind: string; detail: string };
export const auditFile = (home: string) => path.join(home, "equipo-audit.jsonl");

export function readAudit(home: string, limit = 100): AuditLine[] {
  try {
    const lines = fs.readFileSync(auditFile(home), "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditLine)
      .reverse();
  } catch {
    return [];
  }
}

export type AgentDeps = {
  home: string;
  secrets: Secrets;
  log: Log;
  approval: Approval;
  notify: Notify;
  keys: KeyStore;
  /** Icono persistente mientras haya una sesión activa (solo donde el sistema lo permite). */
  tray: Tray;
  run?: Run;
  /** Cuánto esperar antes de reintentar la conexión (se inyecta en los tests). */
  retryMs?: (attempt: number) => number;
  /** Cómo se llama este equipo por defecto. */
  hostname?: () => string;
  platform?: () => string;
};

const wsUrl = (base: string) => `${base.replace(/\/+$/, "").replace(/^http/, "ws")}${EQUIPO_PATH}`;
const summary = (op: Op) =>
  op.op === "run" ? `ejecutar: ${op.command}` : op.op === "read" ? `leer: ${op.path}` : `subir: ${op.path}`;

export function createEquipoAgent(d: AgentDeps) {
  let socket: WebSocket | undefined;
  let connected = false;
  let stopped = true;
  let attempt = 0;
  let timer: NodeJS.Timeout | undefined;
  let busy = 0;
  /** Avisa al principal de que este equipo se revoca (solo mientras hay sesión abierta). */
  let tellRevoke: (() => void) | undefined;
  const run = d.run ?? runCommand;

  const audit = (kind: string, detail: string) => {
    try {
      fs.mkdirSync(d.home, { recursive: true });
      fs.appendFileSync(
        auditFile(d.home),
        `${JSON.stringify({ at: new Date().toISOString(), kind, detail: detail.slice(0, 600) })}\n`,
        {
          mode: 0o600,
        },
      );
    } catch {}
  };
  /** Apretón de manos común: verifica al principal (huella fijada) y deja listos los dos sentidos del canal. */
  function handshake(
    ws: WebSocket,
    mode: "pair" | "session",
    pinned: { fingerprint: string; publicKey?: string },
    id: string | undefined,
    onReady: (c: { tr: Buffer; send: (m: object) => void; recv: (s: string) => unknown; pub: string }) => void,
    fail: (why: string) => void,
  ) {
    const eph = newEphemeral();
    const nonce = newNonce();
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", mode, ...(id ? { id } : {}), eph: eph.pub, nonce })));
    const timeout = setTimeout(() => fail("el principal no contestó"), HANDSHAKE_MS);
    ws.once("close", () => clearTimeout(timeout));
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        const refused = Plain.safeParse(JSON.parse(String(raw)));
        if (refused.success) return fail(refused.data.why);
        const h = ServerHello.parse(JSON.parse(String(raw)));
        const tr = transcript(mode, eph.pub, nonce, h.eph, h.nonce);
        if (!sameFingerprint(fingerprintOf(h.pub), pinned.fingerprint))
          return fail("la huella del principal no coincide");
        if (pinned.publicKey && h.pub !== pinned.publicKey) return fail("la clave del principal cambió");
        if (!verifyAs("principal", tr, h.sig, h.pub)) return fail("la firma del principal no es válida");
        const keys = deriveKeys(eph, h.eph, tr, "client");
        const seal = createSealer(keys.send);
        const open = createOpener(keys.receive);
        onReady({
          tr,
          pub: h.pub,
          send: (m) => ws.send(JSON.stringify({ t: "x", d: seal(Buffer.from(JSON.stringify(m))) })),
          recv: (s) => JSON.parse(open(Sealed.parse(JSON.parse(s)).d).toString()),
        });
      } catch (e) {
        fail(`conexión rechazada: ${(e as Error).message}`);
      }
    });
  }

  /** El dueño tecleó el código en este equipo: se emparejan y queda guardado. */
  function pair(a: {
    url: string;
    fingerprint: string;
    code: string;
    name?: string;
    passphrase?: string;
  }): Promise<{ name: string }> {
    if (d.keys.needsPassphrase() && (a.passphrase?.length ?? 0) < 8)
      return Promise.reject(
        new Error(
          "este equipo no tiene almacén de claves del sistema (llavero): para emparejarlo elige una contraseña de al menos 8 caracteres que proteja la clave; sin ella no se empareja",
        ),
      );
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl(a.url));
      const name = (a.name?.trim() || d.hostname?.() || "Mi equipo").slice(0, 80);
      const fail = (why: string) => {
        ws.terminate();
        reject(new Error(why));
      };
      ws.on("error", (e) => fail(`no se pudo conectar con ${a.url}: ${e.message}`));
      handshake(
        ws,
        "pair",
        { fingerprint: a.fingerprint },
        undefined,
        (c) => {
          const me = generateIdentity();
          c.send({
            t: "pair",
            pub: me.publicKey,
            name,
            platform: d.platform?.() ?? process.platform,
            proof: pairProof(a.code.replace(/\D/g, ""), c.tr, me.publicKey),
            sig: signAs("equipo", c.tr, me.privateKey),
          });
          ws.on("message", (raw) => {
            try {
              const m = ToEquipo.parse(c.recv(String(raw)));
              if (m.t === "paired") {
                d.keys.save(me, a.passphrase);
                writeState(d.home, {
                  id: m.id,
                  name,
                  principal: { url: a.url, fingerprint: fingerprintOf(c.pub), publicKey: c.pub },
                  always: false,
                });
                audit("emparejado", `emparejado con ${a.url}; confirmaste el código aquí`);
                resolve({ name });
                ws.close();
              } else if (m.t === "refused") {
                const why: Record<string, string> = {
                  wrong: "el código no es correcto",
                  expired: "el código ha caducado: pide uno nuevo",
                  locked: "demasiados intentos: pide un código nuevo",
                  none: "no hay ningún código activo: pide uno nuevo",
                };
                audit("emparejamiento_fallido", m.why);
                fail(why[m.why] ?? m.why);
              }
            } catch (e) {
              fail((e as Error).message);
            }
          });
        },
        fail,
      );
    });
  }

  async function serve(op: Op): Promise<Result> {
    if (op.op === "run") return run(op);
    if (op.op === "read") return readFile(op.path);
    return writeFile(op.path, op.content_base64);
  }

  function connect() {
    const state = readState(d.home);
    const me = d.keys.load();
    if (stopped || !state || !me) return;
    const ws = new WebSocket(wsUrl(state.principal.url));
    socket = ws;
    const retry = () => {
      connected = false;
      d.tray.hide();
      // CONEXION-APROBACION-1: lo aprobado vale mientras dure ESTA conexión; si se cae, la sesión vuelve a pedirlo.
      d.approval.reset();
      if (socket === ws) socket = undefined;
      if (stopped || !readState(d.home)) return;
      timer = setTimeout(connect, d.retryMs?.(attempt++) ?? Math.min(30_000, 1000 * 2 ** attempt++));
      timer.unref();
    };
    ws.on("error", () => {});
    ws.on("close", retry);
    handshake(
      ws,
      "session",
      state.principal,
      state.id,
      (c) => {
        c.send({ t: "auth", sig: signAs("equipo", c.tr, me.privateKey) });
        tellRevoke = () => c.send({ t: "revoke" });
        ws.on("message", async (raw) => {
          let m: ToEquipo;
          try {
            m = ToEquipo.parse(c.recv(String(raw)));
          } catch {
            return ws.terminate();
          }
          if (m.t === "ready") {
            connected = true;
            attempt = 0;
            audit("conectado", "conectado con el principal");
          } else if (m.t === "revoked") {
            audit("revocado", "el principal revocó este equipo");
            forget();
          } else if (m.t === "req") {
            const line = summary(m.op);
            audit("peticion", `${m.who.name}: ${line}`);
            const ok = await d.approval.authorize(m.who, line);
            if (!ok) {
              audit("denegado", `${m.who.name}: ${line}`);
              return c.send({ t: "res", id: m.id, ok: false, error: "el dueño del equipo no lo aprobó" });
            }
            busy++;
            d.tray.show("Colonia está usando este equipo");
            d.notify("Colonia está usando este equipo", `${m.who.name}: ${line}`);
            try {
              const result = await serve(m.op);
              audit("hecho", `${line}: correcto`);
              c.send({ t: "res", id: m.id, ok: true, result });
            } catch (e) {
              audit("fallo", `${line}: ${(e as Error).message}`);
              c.send({ t: "res", id: m.id, ok: false, error: (e as Error).message });
            } finally {
              busy--;
            }
          }
        });
      },
      (why) => {
        audit("conexion_rechazada", why);
        ws.terminate();
      },
    );
  }

  /** Se borra todo lo del emparejamiento en este equipo: la clave, el estado y lo aprobado. */
  function forget() {
    stopped = true;
    clearTimeout(timer);
    d.approval.reset();
    d.keys.clear();
    d.tray.hide();
    writeState(d.home, undefined);
    connected = false;
    tellRevoke = undefined;
    socket?.terminate();
    socket = undefined;
  }

  return {
    pair,
    /** Arranca (o rearranca) la conexión si este equipo está emparejado. */
    start() {
      stopped = false;
      clearTimeout(timer); // un reintento pendiente + este connect() dejarían dos conexiones peleándose
      if (!socket && readState(d.home)) connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      d.approval.reset();
      d.tray.hide();
      d.keys.forget();
      socket?.terminate();
      socket = undefined;
      connected = false;
    },
    /** «Desconectar» en el equipo: avisa al principal (que revoca su lado) y borra la clave aquí. */
    async disconnect(): Promise<boolean> {
      const state = readState(d.home);
      if (!state) return false;
      audit("desconectado", "el dueño desconectó este equipo desde aquí");
      if (connected && tellRevoke) {
        tellRevoke();
        await new Promise((r) => setTimeout(r, 250));
      }
      forget();
      return true;
    },
    state(): EquipoState | undefined {
      return readState(d.home);
    },
    connected: () => connected,
    locked: () => d.keys.locked(),
    needsPassphrase: () => d.keys.needsPassphrase(),
    /** Tras reiniciar, sin llavero del sistema, la contraseña desbloquea la clave y se reanuda la conexión. */
    unlock(passphrase: string): boolean {
      if (!d.keys.load(passphrase)) return false;
      stopped = false;
      if (!socket && readState(d.home)) connect();
      return true;
    },
    inUse: () => busy > 0,
    audit: (limit?: number) => readAudit(d.home, limit),
  };
}
export type EquipoAgent = ReturnType<typeof createEquipoAgent>;
