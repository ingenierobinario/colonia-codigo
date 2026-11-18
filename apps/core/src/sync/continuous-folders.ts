import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToCore } from "node:timers/promises";
import type { SyncStatus } from "@colonia/protocol";
import { z } from "zod";
import { FOLDER_LIMIT, folderPermissions } from "./continuous-folder-permissions.ts";
import { continuousFolderStore, type FolderRevision } from "./continuous-folder-store.ts";

const CHUNK = 256 * 1024;
const SCAN_MS = 4000;
const DEADLINE_MS = 30000;
const id = z.string().min(1).max(160);
const revision = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 ** 3),
  })
  .nullable();
const key = { project: id, transfer: z.uuid() };
const offer = z.object({
  ...key,
  op: z.literal("offer"),
  path: z.string().min(1).max(4096),
  base: revision,
  version: revision,
});
export const FolderMessage = z.discriminatedUnion("op", [
  z.object({ op: z.literal("selection"), projects: z.array(id).max(FOLDER_LIMIT) }),
  offer,
  z.object({
    ...key,
    op: z.literal("pull"),
    at: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 ** 3),
  }),
  z.object({
    ...key,
    op: z.literal("block"),
    at: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 ** 3),
    data: z
      .base64()
      .min(4)
      .max(4 * Math.ceil(CHUNK / 3)),
  }),
  z.object({ ...key, op: z.literal("done"), version: revision }),
  z.object({ ...key, op: z.literal("retry") }),
  z.object({ op: z.literal("idle"), project: id, quiet: z.boolean() }),
]);
type Message = z.infer<typeof FolderMessage>;
type Offer = z.infer<typeof offer>;
type FileVersion = FolderRevision | null;
type Entry = Pick<Offer, "path" | "base" | "version">;
type Receiver = Awaited<ReturnType<ReturnType<typeof continuousFolderStore>["receive"]>>;
type Disk = ReturnType<typeof continuousFolderStore>;
type Session = {
  alive: () => boolean;
  store: Disk;
  entries: Entry[];
  forced: Set<string>;
  base?: Map<string, FileVersion>;
  nextScan: number;
  quiet: boolean | undefined;
  remoteQuiet: boolean;
  failed: boolean;
};
type Status = NonNullable<SyncStatus["folder_sync"]>;
export type FolderLink = { send(m: Message): void };
const same = (a: FileVersion, b: FileVersion) => a?.sha === b?.sha && a?.bytes === b?.bytes;

/** Cada equipo anuncia su selección por el enlace autenticado y solo compara las carpetas que ambos autorizan. */
export function continuousFolders(
  db: DatabaseSync,
  home: string,
  peer: string,
  managed: boolean,
  changed: () => void,
  now = Date.now,
) {
  const grants = folderPermissions(db, peer, managed);
  let link: FolderLink | undefined, supported: boolean | undefined, received: Set<string> | undefined;
  let sessions = new Map<string, Session>();
  let outgoing: { msg: Offer; at: number } | undefined;
  let incoming: { msg: Offer; sink?: Receiver; at: number } | undefined;
  let picking = false,
    reading = false,
    busy = false;
  let advertised = "",
    lastProject = "",
    lastCheck = 0;
  function session(project: string): Session {
    const ch = link;
    const alive = () =>
      link === ch && Boolean(ch && received?.has(project)) && sessions.get(project) === s && grants.enabled(project);
    let disk: Disk | undefined;
    const s: Session = {
      alive,
      get store() {
        disk ??= continuousFolderStore({ db, home, peer, project, active: alive });
        return disk;
      },
      entries: [],
      forced: new Set<string>(),
      nextScan: 0,
      quiet: undefined as boolean | undefined,
      remoteQuiet: false,
      failed: false,
    };
    return s;
  }
  function bases(s: Session): Map<string, FileVersion> {
    s.base ??= new Map(s.store.baselines().map((f) => [f.path, f.version]));
    return s.base;
  }
  function ack(s: Session, path: string, version: FileVersion) {
    s.store.ack(path, version);
    bases(s).set(path, version);
  }
  function quiet(project: string, value: boolean) {
    const s = sessions.get(project);
    if (s && s.quiet !== value) {
      s.quiet = value;
      link?.send({ op: "idle", project, quiet: value });
      changed();
    }
  }
  function setParticipants() {
    if (!link || !supported) return;
    const enabled: string[] = [];
    for (const id of grants.entries.keys()) {
      if (!grants.enabled(id)) continue;
      enabled.push(id);
      if (received?.has(id) && !sessions.has(id)) sessions.set(id, session(id));
    }
    for (const [id, s] of sessions)
      if (!s.alive()) {
        sessions.delete(id);
        if (outgoing?.msg.project === id) outgoing = undefined;
        if (incoming?.msg.project === id) incoming = undefined;
      }
    const list = enabled.sort();
    const signature = JSON.stringify(list);
    if (signature !== advertised) {
      advertised = signature;
      link.send({ op: "selection", projects: list });
    }
  }
  function detach() {
    link = undefined;
    received = undefined;
    advertised = "";
    sessions = new Map();
    incoming = undefined;
    outgoing = undefined;
    lastCheck = 0;
  }
  function attach(ch: FolderLink, compatible: boolean) {
    detach();
    link = ch;
    supported = compatible;
    setParticipants();
    changed();
  }
  function error(project: string) {
    const s = sessions.get(project);
    if (!s) return;
    s.entries = [];
    s.nextScan = now() + SCAN_MS;
    s.failed = true;
    quiet(project, false);
    changed();
  }
  async function select() {
    if (picking || outgoing || !link || !received) return;
    picking = true;
    try {
      const projects = [...sessions.keys()];
      const start = (projects.indexOf(lastProject) + 1) % Math.max(projects.length, 1);
      for (let i = 0; i < projects.length; i++) {
        const project = projects[(start + i) % projects.length] as string;
        const s = sessions.get(project);
        if (!s?.alive()) continue;
        try {
          if (!s.entries.length && now() >= s.nextScan) {
            const files = await s.store.inventory();
            if (!s.alive()) continue;
            const base = bases(s);
            const missing = new Set([...base.keys(), ...s.forced]);
            const entries: Entry[] = [];
            let count = 0;
            for (const f of files) {
              missing.delete(f.path);
              const before = base.get(f.path) ?? null,
                version = { sha: f.sha, bytes: f.bytes };
              if (!same(before, version) || s.forced.has(f.path)) entries.push({ path: f.path, base: before, version });
              if (++count % 512 === 0) {
                await yieldToCore();
                if (!s.alive()) break;
              }
            }
            if (!s.alive()) continue;
            for (const path of missing) {
              const before = base.get(path) ?? null;
              if (before || s.forced.has(path)) entries.push({ path, base: before, version: null });
              if (++count % 512 === 0) {
                await yieldToCore();
                if (!s.alive()) break;
              }
            }
            if (!s.alive()) continue;
            s.entries = entries.reverse();
            s.forced.clear();
            s.nextScan = now() + SCAN_MS;
            s.failed = false;
            quiet(project, s.entries.length === 0);
          }
          const entry = s.entries.pop();
          if (!entry) continue;
          const msg: Offer = { op: "offer", transfer: randomUUID(), project, ...entry };
          outgoing = { msg, at: now() };
          lastProject = project;
          quiet(project, false);
          link?.send(msg);
          return;
        } catch {
          if (s.alive()) error(project);
        }
      }
    } finally {
      picking = false;
    }
  }
  function pump() {
    if (!link || !supported) return;
    if (sessions.size && (!lastCheck || now() - lastCheck >= SCAN_MS)) {
      lastCheck = now();
      setParticipants();
    }
    if (outgoing && now() - outgoing.at > DEADLINE_MS) {
      error(outgoing.msg.project);
      outgoing = undefined;
    }
    if (incoming && now() - incoming.at > DEADLINE_MS) {
      error(incoming.msg.project);
      incoming = undefined;
    }
    void select();
  }
  async function receive(ch: FolderLink, m: Message) {
    if (ch !== link || !supported) return;
    if (m.op === "selection") {
      received = new Set(m.projects);
      grants.remote(received);
      setParticipants();
      changed();
      pump();
      return;
    }
    const s = sessions.get(m.project);
    if (!s?.alive()) return;
    if (m.op === "idle") {
      if (s.remoteQuiet !== m.quiet) {
        s.remoteQuiet = m.quiet;
        changed();
      }
      return;
    }
    if (m.op === "pull" || m.op === "done" || m.op === "retry") {
      if (m.op === "retry" && incoming?.msg.transfer === m.transfer && incoming.msg.project === m.project) {
        incoming = undefined;
        error(m.project);
        return;
      }
      const job = outgoing;
      if (!job || job.msg.project !== m.project || job.msg.transfer !== m.transfer) return;
      const f = job.msg;
      job.at = now();
      if (m.op === "retry") {
        outgoing = undefined;
        error(m.project);
        return;
      }
      if (m.op === "done") {
        if (same(m.version, f.version) && same(bases(s).get(f.path) ?? null, f.base)) ack(s, f.path, f.version);
        outgoing = undefined;
        if (!s.entries.length) s.nextScan = 0;
        void select();
        return;
      }
      if (reading || !f.version || m.at >= f.version.bytes) return;
      reading = true;
      try {
        const bytes = await s.store.read(f.path, f.version, m.at, Math.min(CHUNK, f.version.bytes - m.at));
        if (!s.alive() || outgoing !== job) return;
        if (!bytes.length) throw new Error("El archivo ha cambiado.");
        ch.send({ op: "block", project: m.project, transfer: m.transfer, at: m.at, data: bytes.toString("base64") });
      } catch {
        if (s.alive() && outgoing === job) {
          outgoing = undefined;
          error(m.project);
          ch.send({ op: "retry", project: m.project, transfer: m.transfer });
        }
      } finally {
        reading = false;
      }
      return;
    }
    if (busy) return;
    if (m.op === "offer") {
      if (incoming && incoming.msg.transfer !== m.transfer && now() - incoming.at < DEADLINE_MS) {
        ch.send({ op: "retry", project: m.project, transfer: m.transfer });
        return;
      }
      incoming = { msg: m, at: now() };
    }
    const job = incoming;
    if (!job || job.msg.transfer !== m.transfer || job.msg.project !== m.project) return;
    busy = true;
    job.at = now();
    const f = job.msg;
    const still = () => s.alive() && incoming === job;
    try {
      if (m.op === "offer") {
        const baseline = bases(s);
        // Un acuse pudo perderse después de aplicar el archivo. La edición local posterior sigue en el inventario.
        if (!same(m.base, m.version) && baseline.has(m.path) && same(baseline.get(m.path) ?? null, m.version)) {
          incoming = undefined;
          ch.send({ op: "done", project: m.project, transfer: m.transfer, version: m.version });
          return;
        }
        job.sink = await s.store.receive(m.path, m.base, m.version);
      }
      const sink = job.sink;
      if (!still() || !sink) return;
      if (m.op === "block") {
        const bytes = Buffer.from(m.data, "base64");
        if (
          !f.version ||
          m.at !== sink.offset ||
          !bytes.length ||
          bytes.length > CHUNK ||
          m.at + bytes.length > f.version.bytes
        )
          throw new Error("Fragmento de archivo inesperado.");
        await sink.append(m.at, bytes);
        if (!still()) return;
      }
      if (f.version && sink.offset < f.version.bytes) {
        ch.send({ op: "pull", project: f.project, transfer: f.transfer, at: sink.offset });
        return;
      }
      const result = await sink.commit();
      if (!still()) return;
      if (result.conflict) grants.conflict(f.project, result.conflict);
      if (same(result.version, f.version)) ack(s, f.path, result.version);
      else {
        s.forced.add(f.path);
        s.nextScan = 0;
      }
      incoming = undefined;
      ch.send({ op: "done", project: f.project, transfer: f.transfer, version: result.version });
      changed();
    } catch {
      if (still()) {
        incoming = undefined;
        error(f.project);
        ch.send({ op: "retry", project: f.project, transfer: f.transfer });
      }
    } finally {
      busy = false;
    }
  }
  function status(): Status {
    return {
      ...(supported !== undefined ? { supported } : {}),
      projects: [...grants.entries.values()]
        .filter((g) => g.choice > 0 || g.remote)
        .map((g) => {
          const local = grants.enabled(g.project),
            remote = Boolean(g.remote),
            s = sessions.get(g.project);
          const state = !link
            ? "offline"
            : !local || !remote || !supported
              ? "waiting"
              : s?.failed
                ? "failed"
                : s?.quiet && s.remoteQuiet
                  ? "current"
                  : "syncing";
          return { id: g.project, local, remote, state, conflicts: grants.conflicts(g.project) };
        }),
    };
  }
  return {
    attach,
    detach,
    receive,
    pump,
    status,
    set(project: string, on: boolean) {
      grants.set(project, on);
      setParticipants();
      changed();
      pump();
    },
    installed() {
      for (const id of grants.entries.keys()) grants.reconcileManaged(id);
      setParticipants();
      pump();
    },
    dispose(forget: boolean) {
      detach();
      if (forget) grants.clear();
    },
  };
}
