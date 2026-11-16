// D-192 fase 2 · Dos equipos del mismo dueño que se ven iguales. Se emparejan con un código (el mismo apretón de manos
// que «Mis equipos», D-190: clave efímera, firma y prueba del código), hablan directo y cifrado de punta a punta, y se
// pasan lo que el diario (journal.ts) anota en cada uno. Uno de los dos es el principal: solo él abre las sesiones de
// los canales y lleva el reloj de las rutinas; el otro ve su estado y envía a través de él. Sin emparejar no hay nada
// instalado: ni tablas, ni disparadores, ni reloj.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SyncSaved, SyncStatus } from "@colonia/protocol";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { movePath } from "../backup/apply.ts";
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
  sameFingerprint,
  sameProof,
  signAs,
  transcript,
  verifyAs,
} from "../equipos/channel.ts";
import { createPairing } from "../equipos/pairing.ts";
import { ClientHello, Plain, Sealed, ServerHello } from "../equipos/wire.ts";
import type { Log } from "../log.ts";
import {
  type Applied,
  createJournal,
  install,
  installed,
  type Item,
  type Journal,
  type SecretsPort,
  uninstall,
} from "./journal.ts";

export const SYNC_PATH = "/sincronizar";
const STATE_FILE = "sincronizar.json";
const IDENTITY = "sync.identidad";
/** Cambia cuando los dos lados dejan de entenderse: con versiones distintas no se pasan nada. */
const WIRE = 1;
const HANDSHAKE_MS = 15_000;
const BATCH = 200;
const BATCH_WAIT_MS = 60_000;
const FILE_MAX = 64 * 1024 * 1024;
const FILE_CHUNK = 512 * 1024;
const WAITING_MAX = 5000;
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

export type Role = "principal" | "secundario";

const State = z.object({
  peer: z.object({ id: z.string(), name: z.string(), publicKey: z.string(), urls: z.array(z.string()) }),
  role: z.enum(["principal", "secundario"]),
  role_at: z.number(),
  paired_at: z.string(),
  last_sync_at: z.string().optional(),
});
type State = z.infer<typeof State>;

const ItemZ = z.object({
  tbl: z.string(),
  pk: z.string(),
  hlc: z.string(),
  origin: z.string(),
  del: z.boolean(),
  row: z.record(z.string(), z.unknown()).optional(),
});
const Msg = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hola"),
    v: z.number(),
    schema: z.string(),
    home: z.string(),
    user: z.string(),
    win: z.boolean(),
    name: z.string(),
    role: z.enum(["principal", "secundario"]),
    role_at: z.number(),
    urls: z.array(z.string()),
  }),
  z.object({ t: z.literal("cambios"), id: z.string(), items: z.array(ItemZ) }),
  z.object({ t: z.literal("ok"), id: z.string() }),
  z.object({ t: z.literal("papel"), role: z.enum(["principal", "secundario"]), role_at: z.number() }),
  z.object({ t: z.literal("canales"), info: z.array(z.unknown()) }),
  z.object({ t: z.literal("pide"), id: z.string() }),
  z.object({ t: z.literal("fichero"), id: z.string(), data: z.string(), last: z.boolean(), missing: z.boolean() }),
  z.object({ t: z.literal("adios") }),
]);
type Msg = z.infer<typeof Msg>;
const PairMsg = z.object({ t: z.literal("pair"), pub: z.string(), name: z.string(), proof: z.string(), sig: z.string() });
const AuthMsg = z.object({ t: z.literal("auth"), sig: z.string() });
const PairReply = z.union([
  z.object({ t: z.literal("paired"), name: z.string() }),
  z.object({ t: z.literal("refused"), why: z.string() }),
]);

export type SavedVersion = SyncSaved;

export type SyncDeps = {
  home: string;
  db: DatabaseSync;
  secrets: SecretsPort;
  log: Log;
  /** Por dónde alcanza otro equipo a este; vacío si solo escucha en este equipo. */
  urls(): string[];
  /** Este mismo núcleo desde este equipo (dos Colonias en la misma máquina). */
  local(): string;
  name?: () => string;
  secretTravels?: (name: string) => boolean;
  /** Lo que acaba de entrar del otro equipo, por tabla. */
  changed?(touched: Set<string>): void;
  /** Cambió quién lleva los canales (o si hay pareja): arrancan o paran. */
  roleChanged?(): void;
  /** Cambió lo que la tarjeta enseña. */
  told?(): void;
  /** El estado de los canales de este equipo, para que el otro lo vea. */
  channels?(): unknown[];
  tickMs?: number;
  now?: () => number;
};

type Wire = { send(m: object): void; recv(s: string): unknown };
type Link = { ws: WebSocket; client: string; send(m: Msg): void; ready: boolean; hello: boolean };

const wsUrl = (base: string) => `${base.replace(/\/+$/, "").replace(/^http/, "ws")}${SYNC_PATH}`;
const hex = (fingerprint: string) => fingerprint.toLowerCase().replace(/[^0-9a-f]/g, "");

const KINDS: Readonly<Record<string, SyncSaved["kind"]>> = {
  projects: "project",
  agents: "agent",
  persons: "contact",
  addresses: "contact",
  threads: "chat",
  messages: "message",
  memories: "memory",
  routines: "routine",
  flows: "flow",
  flow_graph_drafts: "flow",
  flow_graph_revisions: "flow",
  flow_tables: "flow_table",
  flow_rows: "flow_table",
  tasks: "task",
  "@clave": "secret",
  "@lista:channels": "channel",
  "@lista:webapps": "app",
  "@lista:navegadores": "browser",
  "@lista:providers": "provider",
  "@lista:acp_agents": "provider",
  "@lista:services": "provider",
  "@lista:mcp_servers": "app",
};

export function createSync(d: SyncDeps) {
  const now = d.now ?? Date.now;
  const file = path.join(d.home, STATE_FILE);
  const pairing = createPairing();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const myName = () => (d.name?.() ?? os.hostname()).slice(0, 80) || "Mi equipo";
  const warn = (msg: string, err?: unknown) =>
    d.log.warn(err ? { err: (err as Error).message?.slice(0, 300) } : {}, `sincronizar: ${msg}`);

  let state = readState();
  let journal: Journal | undefined;
  let myId = "";
  let link: Link | undefined;
  let stopped = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticks = 0;
  let inflight: { id: string; items: Item[]; at: number } | undefined;
  let waiting: Item[] = [];
  let mismatch = false;
  let remote: unknown[] | undefined;
  let sentChannels = "";
  let dialing = false;
  let attempt = 0;
  let nextDial = 0;
  let shown: { code: string; expires_at: string } | undefined;
  let stateDirty = 0;
  const wanted: string[] = [];
  let fetching: { id: string; file: string; part: string } | undefined;

  function readState(): State | undefined {
    try {
      return State.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return undefined;
    }
  }
  function saveState(): void {
    stateDirty = 0;
    if (!state) return void fs.rmSync(file, { force: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function identity(create = false): Identity | undefined {
    const raw = d.secrets.resolve(`secret://${IDENTITY}`);
    if (raw) {
      try {
        return JSON.parse(raw) as Identity;
      } catch {}
    }
    if (!create) return undefined;
    const me = generateIdentity();
    d.secrets.set(IDENTITY, JSON.stringify(me));
    return me;
  }
  const idOf = (me: Identity) => hex(fingerprintOf(me.publicKey));
  const schema = () =>
    String(
      (d.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined)
        ?.value ?? "",
    );
  const tell = () => {
    try {
      d.told?.();
    } catch {}
  };

  /** El diario de este equipo, instalado. Al emparejar, lo que ya había se anota (el que se une, como lo más antiguo). */
  function open(me: Identity, baseline?: "first" | "oldest"): void {
    install(d.db);
    myId = idOf(me);
    journal = createJournal({
      db: d.db,
      me: idOf(me),
      secrets: d.secrets,
      ...(d.secretTravels ? { secretTravels: d.secretTravels } : {}),
      warn: (m) => warn(m),
    });
    if (baseline) journal.baseline(baseline === "oldest");
  }

  // ── El enlace ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function established(ws: WebSocket, wire: Wire, client: string): Link | undefined {
    const me = identity();
    if (!state || !me) return void ws.close(1008, "sin pareja");
    const l: Link = {
      ws,
      client,
      ready: false,
      hello: false,
      send: (m) => {
        if (ws.readyState === ws.OPEN) wire.send(m);
      },
    };
    // Los dos marcan: si se cruzan dos conexiones, queda la que abrió el equipo de identificador menor.
    if (link && link.ws !== ws) {
      if (link.client !== client && link.client < client) return void ws.close(1000, "ya hay enlace");
      const old = link;
      link = undefined;
      old.ws.close(1000, "sustituida");
    }
    link = l;
    inflight = undefined;
    sentChannels = "";
    attempt = 0;
    ws.on("close", () => {
      if (link !== l) return;
      link = undefined;
      inflight = undefined;
      fetching = undefined;
      tell();
    });
    l.send({
      t: "hola",
      v: WIRE,
      schema: schema(),
      home: d.home,
      user: os.homedir(),
      win: process.platform === "win32",
      name: myName(),
      role: state.role,
      role_at: state.role_at,
      urls: d.urls(),
    });
    return l;
  }

  function onMessage(l: Link, m: Msg): void {
    if (link !== l || !state || !journal) return;
    if (m.t === "hola") {
      l.hello = true;
      mismatch = m.v !== WIRE || m.schema !== schema();
      l.ready = !mismatch;
      state.peer.name = m.name;
      // El que marcó ya sabe por dónde llegó; el que recibió aprende por dónde devolver la llamada.
      const known = l.client === state.peer.id ? [] : state.peer.urls.slice(0, 1);
      state.peer.urls = [...new Set([...known, ...m.urls])];
      const from = { fromHome: m.home, fromUser: m.user, fromWin: m.win };
      const to = { toHome: d.home, toUser: os.homedir(), toWin: process.platform === "win32" };
      journal.setMove((p) => movePath(p, { ...from, ...to }));
      // Dos principales (o ninguno) tras estar separados: se queda el papel quien lo cambió el último.
      if (m.role === state.role) {
        const mine = state.role_at !== m.role_at ? state.role_at > m.role_at : myId > state.peer.id;
        if (!mine) setRole(m.role === "principal" ? "secundario" : "principal", m.role_at);
      }
      saveState();
      if (mismatch) warn("los dos equipos tienen versiones distintas de Colonia: no se pasan nada hasta actualizar");
      else setImmediate(missingFiles);
      tell();
      return pump();
    }
    if (m.t === "adios") return forget();
    if (m.t === "papel") {
      setRole(m.role === "principal" ? "secundario" : "principal", m.role_at);
      saveState();
      return tell();
    }
    if (!l.ready) return;
    if (m.t === "cambios") {
      let r: Applied;
      try {
        r = journal.apply([...waiting, ...(m.items as Item[])]);
      } catch (err) {
        // Sin confirmar: el otro lo vuelve a mandar.
        return warn("no se pudo aplicar lo recibido", err);
      }
      waiting = r.waiting.slice(-WAITING_MAX);
      l.send({ t: "ok", id: m.id });
      touchSync();
      for (const i of m.items) if (i.tbl === "media" && !i.del) want(String((JSON.parse(i.pk) as unknown[])[0]));
      try {
        d.changed?.(r.touched);
      } catch (err) {
        warn("lo recibido entró, pero algo no se refrescó", err);
      }
      tell();
      return pump();
    }
    if (m.t === "ok") {
      if (inflight?.id !== m.id) return;
      journal.acked(inflight.items);
      inflight = undefined;
      touchSync();
      tell();
      return pump();
    }
    if (m.t === "canales") {
      remote = m.info;
      return tell();
    }
    if (m.t === "pide") return sendFile(l, m.id);
    if (m.t === "fichero") return receiveFile(m);
  }

  function touchSync(): void {
    if (!state) return;
    state.last_sync_at = new Date(now()).toISOString();
    stateDirty ||= now();
  }

  function pump(): void {
    if (!link?.ready || inflight || !journal) return;
    const items = journal.pending(BATCH);
    if (!items.length) return;
    inflight = { id: randomUUID(), items, at: now() };
    link.send({ t: "cambios", id: inflight.id, items });
  }

  function setRole(role: Role, at: number): void {
    if (!state) return;
    const was = state.role;
    state.role = role;
    state.role_at = at;
    if (was === role) return;
    if (role === "principal") remote = undefined;
    sentChannels = "";
    try {
      d.roleChanged?.();
    } catch (err) {
      warn("los canales no siguieron el cambio de equipo principal", err);
    }
  }

  // ── Ficheros adjuntos: el otro equipo los pide cuando le llega la ficha y no tiene el fichero ───────────────────────

  const inHome = (p: string) => {
    const rel = path.relative(d.home, p);
    return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  const mediaPath = (id: string) =>
    (d.db.prepare("SELECT path FROM media WHERE id = ?").get(id) as { path: string } | undefined)?.path;

  function want(id: string): void {
    const p = mediaPath(id);
    if (!p || !inHome(p) || fs.existsSync(p) || wanted.includes(id) || fetching?.id === id) return;
    wanted.push(id);
    nextFile();
  }
  function missingFiles(): void {
    if (!link?.ready) return;
    try {
      for (const r of d.db.prepare("SELECT id FROM media").all() as { id: string }[]) want(r.id);
    } catch (err) {
      warn("no se pudo mirar qué adjuntos faltan", err);
    }
  }
  function nextFile(): void {
    if (fetching || !link?.ready) return;
    for (;;) {
      const id = wanted.shift();
      if (!id) return;
      const p = mediaPath(id);
      if (!p || !inHome(p) || fs.existsSync(p)) continue;
      fetching = { id, file: p, part: `${p}.sync-part` };
      fs.rmSync(fetching.part, { force: true });
      return link.send({ t: "pide", id });
    }
  }
  function sendFile(l: Link, id: string): void {
    const none = () => l.send({ t: "fichero", id, data: "", last: true, missing: true });
    const p = mediaPath(id);
    let fd: number | undefined;
    try {
      if (!p || !inHome(p)) return none();
      const size = fs.statSync(p).size;
      if (size > FILE_MAX) return none();
      fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(FILE_CHUNK);
      let sent = 0;
      do {
        const n = fs.readSync(fd, buf, 0, FILE_CHUNK, sent);
        sent += n;
        l.send({ t: "fichero", id, data: buf.subarray(0, n).toString("base64"), last: sent >= size, missing: false });
      } while (sent < size);
    } catch {
      none();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  function receiveFile(m: Extract<Msg, { t: "fichero" }>): void {
    const f = fetching;
    if (!f || f.id !== m.id) return;
    try {
      if (m.missing) fs.rmSync(f.part, { force: true });
      else {
        fs.mkdirSync(path.dirname(f.file), { recursive: true });
        fs.appendFileSync(f.part, Buffer.from(m.data, "base64"));
        if (!m.last) return;
        fs.renameSync(f.part, f.file);
      }
    } catch (err) {
      warn("un adjunto no se pudo guardar", err);
    }
    fetching = undefined;
    if (!m.missing) {
      try {
        d.changed?.(new Set(["@fichero"]));
      } catch {}
    }
    nextFile();
  }

  // ── Apretón de manos (el de «Mis equipos»): quien marca fija la huella del otro ────────────────────────────────────

  function clientHandshake(
    ws: WebSocket,
    mode: "pair" | "session",
    id: string | undefined,
    pinned: { fingerprint: string; publicKey?: string },
    onReady: (c: Wire & { tr: Buffer; pub: string }) => void,
    fail: (why: string) => void,
  ): void {
    const eph = newEphemeral();
    const nonce = newNonce();
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", mode, ...(id ? { id } : {}), eph: eph.pub, nonce })));
    const timeout = setTimeout(() => fail("el otro equipo no contestó"), HANDSHAKE_MS);
    ws.once("close", () => clearTimeout(timeout));
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        const refused = Plain.safeParse(JSON.parse(String(raw)));
        if (refused.success) return fail(refused.data.why);
        const h = ServerHello.parse(JSON.parse(String(raw)));
        const tr = transcript(mode, eph.pub, nonce, h.eph, h.nonce);
        if (!sameFingerprint(fingerprintOf(h.pub), pinned.fingerprint)) return fail("ese no es el equipo del código");
        if (pinned.publicKey && h.pub !== pinned.publicKey) return fail("la clave del otro equipo cambió");
        if (!verifyAs("principal", tr, h.sig, h.pub)) return fail("la firma del otro equipo no es válida");
        const keys = deriveKeys(eph, h.eph, tr, "client");
        const seal = createSealer(keys.send);
        const unseal = createOpener(keys.receive);
        onReady({
          tr,
          pub: h.pub,
          send: (m) => ws.send(JSON.stringify({ t: "x", d: seal(Buffer.from(JSON.stringify(m))) })),
          recv: (s) => JSON.parse(unseal(Sealed.parse(JSON.parse(s)).d).toString()),
        });
      } catch (e) {
        fail(`conexión rechazada: ${(e as Error).message}`);
      }
    });
  }

  function accept(ws: WebSocket): void {
    let phase: "hello" | "pair" | "auth" | "ready" | "dead" = "hello";
    let wire: Wire | undefined;
    let tr: Buffer | undefined;
    let l: Link | undefined;
    const end = (why?: string) => {
      phase = "dead";
      if (why && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "refused", why }));
      ws.close(1008, "cerrado");
    };
    const timeout = setTimeout(() => phase !== "ready" && end(), HANDSHAKE_MS);
    ws.on("close", () => clearTimeout(timeout));
    ws.on("error", () => {});
    ws.on("message", (raw: RawData) => {
      try {
        const text = String(raw);
        if (phase === "hello") {
          const h = ClientHello.parse(JSON.parse(text));
          const me = identity();
          if (!me || stopped) return end("unpaired");
          if (h.mode === "session" && (!state || h.id !== state.peer.id)) return end("unpaired");
          if (h.mode === "pair" && state) return end("busy");
          const eph = newEphemeral();
          const nonce = newNonce();
          tr = transcript(h.mode, h.eph, h.nonce, eph.pub, nonce);
          const keys = deriveKeys(eph, h.eph, tr, "server");
          const seal = createSealer(keys.send);
          const unseal = createOpener(keys.receive);
          wire = {
            send: (m) => ws.send(JSON.stringify({ t: "x", d: seal(Buffer.from(JSON.stringify(m))) })),
            recv: (s) => JSON.parse(unseal(Sealed.parse(JSON.parse(s)).d).toString()),
          };
          ws.send(
            JSON.stringify({
              t: "hello",
              eph: eph.pub,
              nonce,
              pub: me.publicKey,
              sig: signAs("principal", tr, me.privateKey),
            }),
          );
          phase = h.mode === "pair" ? "pair" : "auth";
          return;
        }
        if (!wire || !tr) return end();
        const msg = wire.recv(text);
        if (phase === "pair") {
          const p = PairMsg.parse(msg);
          const me = identity();
          const t = tr;
          if (!me || state) return end("busy");
          if (!verifyAs("equipo", t, p.sig, p.pub)) return end("firma no válida");
          const result = pairing.attempt((code) => sameProof(p.proof, pairProof(code, t, p.pub)));
          if (result !== "ok") {
            wire.send({ t: "refused", why: result });
            phase = "dead";
            return void setTimeout(() => ws.close(1008, "cerrado"), 50);
          }
          // Quien generó el código es el principal y, en lo que los dos ya tenían, manda lo suyo.
          state = {
            peer: { id: hex(fingerprintOf(p.pub)), name: p.name.slice(0, 80), publicKey: p.pub, urls: [] },
            role: "principal",
            role_at: now(),
            paired_at: new Date(now()).toISOString(),
          };
          shown = undefined;
          open(me, "first");
          saveState();
          wire.send({ t: "paired", name: myName() });
          phase = "dead";
          tell();
          return void setTimeout(() => ws.close(1000, "emparejado"), 50);
        }
        if (phase === "auth") {
          const a = AuthMsg.parse(msg);
          if (!state || !verifyAs("equipo", tr, a.sig, state.peer.publicKey)) return end("firma no válida");
          l = established(ws, wire, state.peer.id);
          if (!l) return;
          phase = "ready";
          return tell();
        }
        if (phase === "ready" && l) onMessage(l, Msg.parse(msg));
      } catch (err) {
        if (phase === "ready") warn("mensaje del otro equipo que no se entiende", err);
        ws.terminate();
      }
    });
  }

  function dial(): void {
    const me = identity();
    if (stopped || !state || !me || link || dialing || now() < nextDial) return;
    const urls = state.peer.urls;
    if (!urls.length) return;
    dialing = true;
    const peer = state.peer;
    const tryAt = (i: number): void => {
      const url = urls[i];
      const again = () => {
        if (i + 1 < urls.length) return tryAt(i + 1);
        dialing = false;
        nextDial = now() + (RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)] ?? 30_000);
      };
      if (!url || stopped || !state || link) return void (dialing = false);
      let done = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(url), { maxPayload: 64 * 1024 * 1024 });
      } catch {
        return again();
      }
      const fail = () => {
        if (done) return;
        done = true;
        ws.terminate();
        again();
      };
      ws.on("error", fail);
      ws.on("close", fail);
      clientHandshake(
        ws,
        "session",
        idOf(me),
        { fingerprint: fingerprintOf(peer.publicKey), publicKey: peer.publicKey },
        (c) => {
          done = true;
          dialing = false;
          c.send({ t: "auth", sig: signAs("equipo", c.tr, me.privateKey) });
          const l = established(ws, c, idOf(me));
          if (!l) return;
          // Por aquí se llegó: la próxima vez, lo primero.
          if (state && state.peer.urls[0] !== url) {
            state.peer.urls = [url, ...state.peer.urls.filter((u) => u !== url)];
            saveState();
          }
          ws.on("message", (raw) => {
            try {
              onMessage(l, Msg.parse(c.recv(String(raw))));
            } catch (err) {
              warn("mensaje del otro equipo que no se entiende", err);
              ws.terminate();
            }
          });
          tell();
        },
        fail,
      );
    };
    tryAt(0);
  }

  function tick(): void {
    if (stopped || !state || !journal) return;
    try {
      journal.seal();
      if (++ticks % 5 === 0) journal.scanSecrets();
    } catch (err) {
      warn("no se pudo anotar lo que cambió", err);
    }
    if (link?.ready && state.role === "principal" && d.channels) {
      const info = d.channels();
      const s = JSON.stringify(info);
      if (s !== sentChannels) {
        sentChannels = s;
        link.send({ t: "canales", info });
      }
    }
    if (inflight && now() - inflight.at > BATCH_WAIT_MS) link?.ws.terminate();
    pump();
    if (!fetching) nextFile();
    dial();
    if (stateDirty && now() - stateDirty > 15_000) saveState();
  }

  /** Este equipo deja de tener pareja: se quita el diario y lo guardado, y los canales vuelven a ser solo suyos. */
  function forget(): void {
    const was = state?.role;
    const old = link;
    link = undefined;
    old?.ws.close(1000, "desemparejado");
    state = undefined;
    journal = undefined;
    inflight = undefined;
    waiting = [];
    remote = undefined;
    mismatch = false;
    wanted.length = 0;
    fetching = undefined;
    saveState();
    try {
      uninstall(d.db, d.secrets);
      d.secrets.set(IDENTITY, null);
      // El equipo que no llevaba los canales los deja apagados: encenderlos aquí a la vez que en el otro abriría la
      // misma cuenta dos veces. El dueño los enciende donde los quiera.
      if (was === "secundario") {
        const row = d.db.prepare("SELECT value FROM meta WHERE key = 'setting:channels'").get() as
          | { value: string }
          | undefined;
        const list = row ? (JSON.parse(row.value) as { enabled?: boolean }[]) : [];
        if (Array.isArray(list) && list.some((c) => c.enabled !== false))
          d.db
            .prepare("UPDATE meta SET value = ? WHERE key = 'setting:channels'")
            .run(JSON.stringify(list.map((c) => ({ ...c, enabled: false }))));
      }
    } catch (err) {
      warn("no se pudo quitar todo al desemparejar", err);
    }
    try {
      d.roleChanged?.();
    } catch {}
    tell();
  }

  const decode = (text: string) => {
    const m = /^(\d{6})-([0-9a-f]{32})-([A-Za-z0-9_-]*)$/.exec(text.replace(/\s+/g, ""));
    if (!m) return undefined;
    const urls = Buffer.from(m[3] ?? "", "base64url").toString().split("\n").filter(Boolean);
    return { code: m[1] as string, fingerprint: m[2] as string, urls };
  };

  return {
    path: SYNC_PATH,
    /** El enganche del servidor HTTP. Sin cabecera Origin: no es un navegador. */
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      if (req.headers.origin || stopped) return void socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => accept(ws));
    },
    start(): void {
      stopped = false;
      const me = identity();
      if (state && me) open(me);
      else {
        // Sin pareja no queda nada puesto (una ficha a medias, un diario de una pareja anterior).
        if (state) {
          state = undefined;
          saveState();
        }
        if (installed(d.db)) uninstall(d.db, d.secrets);
      }
      timer = setInterval(tick, d.tickMs ?? 1000);
      timer.unref?.();
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
      try {
        if (stateDirty) saveState();
      } catch (err) {
        warn("no se pudo guardar la hora del último sincronizado", err);
      }
      link?.ws.close(1001, "cerrando");
      link = undefined;
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
    /** Este equipo no lleva los canales ni el reloj: los lleva su pareja. */
    secondary: () => state?.role === "secundario",
    remoteChannels: () => remote,
    status(): SyncStatus {
      if (shown && Date.parse(shown.expires_at) <= now()) shown = undefined;
      return {
        paired: Boolean(state),
        reachable: d.urls().length > 0,
        ...(shown && !state ? { pairing: shown } : {}),
        ...(state ? { peer: { name: state.peer.name }, role: state.role } : {}),
        connected: Boolean(link?.hello),
        mismatch: Boolean(link?.hello) && mismatch,
        pending: journal?.pendingCount() ?? 0,
        ...(state?.last_sync_at ? { last_sync_at: state.last_sync_at } : {}),
        saved: journal?.lost(1, 0).total ?? 0,
      };
    },
    /** Un código para escribir en el otro equipo: vale diez minutos y una sola vez. */
    pairStart(): { code: string; expires_at: string } {
      if (state) throw new Error("este equipo ya está emparejado");
      const me = identity(true) as Identity;
      const { code, expiresAt } = pairing.start();
      const urls = d.urls().length ? d.urls() : [d.local()];
      shown = {
        code: `${code}-${idOf(me)}-${Buffer.from(urls.join("\n")).toString("base64url")}`,
        expires_at: new Date(expiresAt).toISOString(),
      };
      tell();
      return shown;
    },
    pairCancel(): void {
      pairing.cancel();
      shown = undefined;
      tell();
    },
    /** El dueño escribió aquí el código del otro equipo: este se une como secundario. */
    pairJoin(text: string, address?: string): Promise<{ name: string }> {
      if (state) return Promise.reject(new Error("este equipo ya está emparejado"));
      const parsed = decode(text);
      if (!parsed) return Promise.reject(new Error("ese código no es válido: cópialo entero del otro equipo"));
      const urls = address ? [address] : parsed.urls;
      const me = identity(true) as Identity;
      const tryAt = (i: number, last: string): Promise<{ name: string }> => {
        const url = urls[i];
        if (!url)
          return Promise.reject(
            new Error(`no se pudo conectar con el otro equipo (${last}): comprueba que está encendido y en la misma red`),
          );
        return new Promise<{ name: string }>((resolve, reject) => {
          const ws = new WebSocket(wsUrl(url));
          let hard = false;
          const fail = (why: string) => {
            ws.terminate();
            reject(new Error(why));
          };
          ws.on("error", (e) => fail(e.message));
          clientHandshake(
            ws,
            "pair",
            undefined,
            { fingerprint: parsed.fingerprint },
            (c) => {
              hard = true;
              c.send({
                t: "pair",
                pub: me.publicKey,
                name: myName(),
                proof: pairProof(parsed.code, c.tr, me.publicKey),
                sig: signAs("equipo", c.tr, me.privateKey),
              });
              ws.on("message", (raw) => {
                try {
                  const m = PairReply.parse(c.recv(String(raw)));
                  if (m.t === "refused") {
                    const why: Record<string, string> = {
                      wrong: "el código no es correcto",
                      expired: "el código ha caducado: genera uno nuevo en el otro equipo",
                      locked: "demasiados intentos: genera un código nuevo en el otro equipo",
                      none: "ese código ya no vale: genera uno nuevo en el otro equipo",
                    };
                    return fail(`!${why[m.why] ?? m.why}`);
                  }
                  state = {
                    peer: {
                      id: hex(fingerprintOf(c.pub)),
                      name: m.name.slice(0, 80),
                      publicKey: c.pub,
                      urls: [url, ...parsed.urls.filter((u) => u !== url)],
                    },
                    role: "secundario",
                    role_at: now(),
                    paired_at: new Date(now()).toISOString(),
                  };
                  open(me, "oldest");
                  saveState();
                  ws.close();
                  try {
                    d.roleChanged?.();
                  } catch {}
                  tell();
                  nextDial = 0;
                  resolve({ name: m.name });
                } catch (e) {
                  fail(`!${(e as Error).message}`);
                }
              });
            },
            (why) => fail(hard || why === "busy" ? `!${why === "busy" ? "el otro equipo ya está emparejado" : why}` : why),
          );
        }).catch((e: Error) => {
          // Con «!» el otro equipo contestó y dijo que no: probar otra dirección no cambia nada.
          if (e.message.startsWith("!")) throw new Error(e.message.slice(1));
          return tryAt(i + 1, e.message);
        });
      };
      return tryAt(0, "sin dirección");
    },
    /** Desempareja los dos (el otro, si está conectado, ahora; si no, cuando vea que este ya no le reconoce). */
    unpair(): void {
      link?.send({ t: "adios" });
      forget();
    },
    /** Los canales y el reloj pasan a este equipo. */
    makePrincipal(): void {
      if (!state || state.role === "principal") return;
      const at = now();
      setRole("principal", at);
      saveState();
      link?.send({ t: "papel", role: "principal", role_at: at });
      tell();
    },
    saved(limit = 20, offset = 0): { total: number; items: SavedVersion[] } {
      const r = journal?.lost(limit, offset) ?? { total: 0, items: [] };
      const me = myId;
      return {
        total: r.total,
        items: r.items.map((i) => {
          let row: Record<string, unknown> = {};
          try {
            row = JSON.parse(i.row) as Record<string, unknown>;
          } catch {}
          const setting = i.tbl === "meta" || i.tbl.startsWith("@");
          const label = [row.name, row.title, row.label, row.text, row.id].find(
            (v) => typeof v === "string" && v.trim(),
          ) as string | undefined;
          return {
            id: i.id,
            kind: KINDS[i.tbl] ?? (setting ? "setting" : "other"),
            label: (label ?? "").slice(0, 120),
            mine: i.origin === me,
            lost_at: i.lost_at,
            ...(i.recovered_at ? { recovered_at: i.recovered_at } : {}),
          };
        }),
      };
    },
    recover(id: string): boolean {
      if (!journal) return false;
      const tbl = journal.lost(1000, 0).items.find((i) => i.id === id)?.tbl;
      const ok = journal.recover(id);
      if (ok) {
        try {
          d.changed?.(new Set(tbl ? [tbl] : []));
        } catch {}
        tell();
      }
      return ok;
    },
    /** Para las pruebas: un latido ahora. */
    tick,
  };
}

export type Sync = ReturnType<typeof createSync>;
