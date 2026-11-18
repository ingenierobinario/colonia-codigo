import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SyncStatus } from "@colonia/protocol";
import { z } from "zod";
import { fileTarget, writeAll } from "../backup/project-file-io.ts";
import { realpath, samePath, writeAtomic } from "../paths.ts";
import { folderIdentity } from "./continuous-folder-permissions.ts";
import { hasProjectWork, installProjectWork, prepareProjectWork } from "./project-work-archive.ts";

const CHUNK = 256 * 1024;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const transfer = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const projectId = z.string().min(1).max(160);
const descriptor = z.object({
  transfer,
  project: projectId,
  sha: hash,
  size: count.positive(),
  password: z.string().length(43),
  files: count,
  bytes: count,
});
type Descriptor = z.infer<typeof descriptor>;
export const WorkMessage = z.discriminatedUnion("op", [
  descriptor.extend({ op: z.literal("start") }),
  z.object({ op: z.literal("next"), transfer, at: count }),
  z.object({
    op: z.literal("chunk"),
    transfer,
    at: count,
    data: z
      .base64()
      .min(4)
      .max(4 * Math.ceil(CHUNK / 3)),
  }),
  z.object({ op: z.literal("done"), transfer, sha: hash }),
  z.object({ op: z.literal("failed"), transfer }),
]);
type Message = z.infer<typeof WorkMessage>;
type Status = NonNullable<SyncStatus["project_files"]>;
type Why = NonNullable<Status["why"]>;
const savedQueue = z.object({
  jobs: z
    .array(
      z.object({
        transfer,
        project: projectId,
        folder: z.string().optional(),
        archive: descriptor.optional(),
        receipt: z.object({ files: count, bytes: count }).optional(),
      }),
    )
    .max(10000),
  why: z.enum(["source", "destination", "unsupported", "selection"]).optional(),
});
type Queue = z.infer<typeof savedQueue>;
type Link = { send(m: Message): void };
export type WorkLink = Link;
/** Una vez confirmada la instalación, Windows puede retener la instantánea hasta que se cierre un lector. */
function removeConfirmed(file: string) {
  try {
    fs.rmSync(file, { force: true });
  } catch {}
}
export function validateWorkSelection(db: DatabaseSync, projects: string[]) {
  const ids = [...new Set(projects)];
  if (!ids.length) throw new Error("Elige proyectos registrados que tengan una carpeta en este equipo.");
  return ids.map((project) => ({ project, folder: folderIdentity(db, project) }));
}
type SelectedFolder = ReturnType<typeof validateWorkSelection>[number];
type WorkJob = Queue["jobs"][number];
export function selectedFolderStillHere(db: DatabaseSync, job: { project: string; folder?: string }) {
  if (!job.folder) return false;
  try {
    return job.folder === folderIdentity(db, job.project);
  } catch {
    return false;
  }
}

function openRegular(file: string, flags: number) {
  const fd = fs.openSync(file, flags | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const current = fs.lstatSync(file),
      opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      !samePath(realpath(file), file)
    )
      throw new Error("La copia temporal ha cambiado.");
    return fd;
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}
async function sha256(file: string) {
  const digest = createHash("sha256");
  for await (const data of fs.createReadStream(file, { fd: openRegular(file, fs.constants.O_RDONLY), autoClose: true }))
    digest.update(data);
  return digest.digest("hex");
}

/** Una selección humana solo vale para esta identidad autenticada. Un reinicio conserva el archivo que se enviaba y sus acuses. */
export function projectWork(
  db: DatabaseSync,
  home: string,
  peer: string,
  mode: "send" | "receive",
  changed: () => void,
  installed: () => void,
) {
  if (!/^[a-f0-9]{32}$/.test(peer)) throw new Error("Identidad de equipo no válida");
  const base = realpath(home);
  const dir = path.join(base, "sync-proyectos", peer);
  const workspace = () => fileTarget(base, `sync-proyectos/${peer}/solicitud.json`);
  const meta = path.join(dir, "solicitud.json");
  let queue: Queue | undefined;
  if (mode === "send" && fs.existsSync(meta)) {
    try {
      workspace();
      const fd = openRegular(meta, fs.constants.O_RDONLY);
      try {
        queue = savedQueue.parse(JSON.parse(fs.readFileSync(fd, "utf8")));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      queue = { jobs: [], why: "source" };
    }
  }
  const store = () => {
    if (!queue) return;
    workspace();
    writeAtomic(meta, JSON.stringify(queue), 0o600);
    changed();
  };
  function status(): Status | undefined {
    if (!queue) return;
    const complete = queue.jobs.flatMap((j) => (j.receipt ? [j.receipt] : []));
    return {
      state: queue.why ? "failed" : complete.length === queue.jobs.length ? "done" : "working",
      projects: queue.jobs.length,
      completed: complete.length,
      files: complete.reduce((n, r) => n + r.files, 0),
      bytes: complete.reduce((n, r) => n + r.bytes, 0),
      ...(queue.why ? { why: queue.why } : {}),
    };
  }
  const archive = (id: string) => path.join(dir, `${id}.colonia`);
  function discardSnapshot(job: WorkJob) {
    // Sólo el contenedor generado que consta en la cola privada, nunca la carpeta de trabajo.
    if (job.archive) {
      workspace();
      removeConfirmed(archive(job.transfer));
      delete job.archive;
    }
  }
  function revoke(job: WorkJob) {
    if (!queue || job.receipt) return;
    delete job.folder;
    queue.why = "selection";
    offered = undefined;
    store();
    discardSnapshot(job);
    store();
  }
  function selectCaptured(choices: SelectedFolder[]) {
    if (mode !== "send") throw new Error("Elige los proyectos desde el escritorio vinculado.");
    queue ??= { jobs: [] };
    const selected = new Map(choices.map((c) => [c.project, c]));
    // Una selección nueva retira los permisos caducados que la persona decidió omitir.
    queue.jobs = queue.jobs.filter((j) => {
      if (j.receipt || selected.has(j.project) || selectedFolderStillHere(db, j)) return true;
      discardSnapshot(j);
      return false;
    });
    for (const choice of choices) {
      const i = queue.jobs.findIndex((j) => j.project === choice.project);
      const previous = i >= 0 ? queue.jobs[i] : undefined;
      if (previous && (previous.folder === choice.folder || (previous.receipt && !previous.folder))) continue;
      if (previous) discardSnapshot(previous);
      const job = { ...choice, transfer: randomUUID() };
      if (i < 0) queue.jobs.push(job);
      else queue.jobs[i] = job;
    }
    delete queue.why;
    const expired = queue.jobs.find((j) => !j.receipt && !selectedFolderStillHere(db, j));
    if (expired) revoke(expired);
    else store();
  }
  function select(projects?: string[]) {
    if (mode !== "send") throw new Error("Elige los proyectos desde el escritorio vinculado.");
    if (!projects && !queue?.jobs.length) throw new Error("Todavía no has elegido proyectos para este servidor.");
    if (projects) return selectCaptured(validateWorkSelection(db, projects));
    if (!queue) return;
    const expired = queue.jobs.find((j) => !j.receipt && !selectedFolderStillHere(db, j));
    if (expired || queue.why === "selection") {
      if (expired) revoke(expired);
      throw new Error("Vuelve a elegir las carpetas del proyecto que quieres copiar.");
    }
    delete queue.why;
    store();
  }

  let link: Link | undefined;
  let offered: string | undefined;
  let lastReply = 0;
  let preparing = false;
  let handling = false;
  let generation = 0;
  let disposed = false;
  let incoming: Descriptor | undefined;

  const partial = (d: Descriptor) => path.join(dir, `${d.transfer}-${d.sha}.part`);
  if (queue?.jobs.some((j) => j.receipt)) {
    workspace();
    for (const j of queue.jobs) if (j.receipt) removeConfirmed(archive(j.transfer));
  }
  const job = () => queue?.jobs.find((j) => !j.receipt);
  // Al actualizar, un trabajo sin acuse y sin una identidad guardada no es un consentimiento actual.
  if (queue?.jobs.some((j) => !j.receipt && !j.folder)) {
    for (const j of queue.jobs) if (!j.receipt && !j.folder) revoke(j);
  }
  const fail = (why: Why) => {
    if (queue && !disposed) {
      queue.why = why;
      offered = undefined;
      store();
    }
  };
  const detach = () => {
    generation++;
    link = undefined;
    offered = undefined;
    incoming = undefined;
  };
  async function pump(channel: Link, supported: boolean) {
    if (disposed || mode !== "send" || !queue || queue.why || preparing) return;
    const j = job();
    if (!j) return;
    if (!selectedFolderStillHere(db, j)) return revoke(j);
    if (!supported) return fail("unsupported");
    link = channel;
    if (offered === j.transfer && Date.now() - lastReply < 30_000) return;
    preparing = true;
    const attempt = generation;
    const target = archive(j.transfer);
    const current = () => !disposed && job() === j && selectedFolderStillHere(db, j);
    const checkSource = () => {
      if (!current()) throw new Error("La carpeta seleccionada ha cambiado.");
    };
    try {
      if (!j.archive) {
        workspace();
        const password = randomBytes(32).toString("base64url");
        const draft = `${target}.tmp`;
        fs.rmSync(draft, { force: true });
        try {
          const totals = await prepareProjectWork(db, home, j.project, draft, password, checkSource);
          const sha = await sha256(draft);
          checkSource();
          fs.renameSync(draft, target);
          j.archive = {
            ...totals,
            project: j.project,
            transfer: j.transfer,
            password,
            sha,
            size: fs.statSync(target).size,
          };
          store();
        } finally {
          if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() && samePath(realpath(dir), dir))
            removeConfirmed(draft);
        }
      }
      if (attempt !== generation || disposed || link !== channel || job() !== j) return;
      checkSource();
      offered = j.transfer;
      lastReply = Date.now();
      channel.send({ op: "start", ...j.archive });
    } catch {
      if (!disposed && job() === j) {
        if (selectedFolderStillHere(db, j)) fail("source");
        else revoke(j);
      }
    } finally {
      preparing = false;
    }
  }
  function sendChunk(ch: Link, at: number, d: Descriptor) {
    if (at >= d.size) throw new Error("Desplazamiento no válido");
    const data = Buffer.allocUnsafe(Math.min(CHUNK, d.size - at));
    workspace();
    const fd = openRegular(archive(d.transfer), fs.constants.O_RDONLY);
    try {
      for (let offset = 0; offset < data.length; ) {
        const n = fs.readSync(fd, data, offset, data.length - offset, at + offset);
        if (!n) throw new Error("La copia cambió durante el envío.");
        offset += n;
      }
    } finally {
      fs.closeSync(fd);
    }
    ch.send({ op: "chunk", transfer: d.transfer, at, data: data.toString("base64") });
  }
  async function finish(ch: Link, d: Descriptor, attempt: number) {
    const file = partial(d);
    if ((await sha256(file)) !== d.sha) throw new Error("El archivo recibido no coincide");
    if (disposed || attempt !== generation) return;
    await installProjectWork({
      db,
      home,
      project: d.project,
      archiveFile: file,
      password: d.password,
      files: d.files,
      bytes: d.bytes,
      peer,
      transfer: d.transfer,
      sha: d.sha,
      active: () => !disposed && attempt === generation,
    });
    removeConfirmed(file);
    if (disposed || attempt !== generation) return;
    incoming = undefined;
    ch.send({ op: "done", transfer: d.transfer, sha: d.sha });
    installed();
  }
  async function receive(ch: Link, m: Message) {
    if (disposed) return;
    if (mode === "send") {
      const j = job(),
        d = j?.archive;
      if (ch !== link || !j || !d || m.transfer !== offered) return;
      lastReply = Date.now();
      if (m.op === "failed") return fail("destination");
      if (m.op === "next") {
        if (!selectedFolderStillHere(db, j)) return revoke(j);
        if (!fs.existsSync(archive(d.transfer))) {
          // El receptor aún no la ha instalado. Después de perder el archivo local hace falta una nueva instantánea.
          j.transfer = randomUUID();
          delete j.archive;
          offered = undefined;
          store();
          return;
        }
        try {
          sendChunk(ch, m.at, d);
        } catch {
          fail("source");
        }
      }
      if (m.op === "done" && m.sha === d.sha) {
        j.receipt = { files: d.files, bytes: d.bytes };
        delete j.archive;
        store();
        removeConfirmed(archive(j.transfer));
        offered = undefined;
      }
      return;
    }
    if (m.op !== "start" && m.op !== "chunk") return;
    if (handling) return;
    handling = true;
    const attempt = generation;
    try {
      if (m.op === "start") {
        workspace();
        if (hasProjectWork(db, peer, m.transfer, m.project, m.sha)) {
          removeConfirmed(partial(m));
          return ch.send({ op: "done", transfer: m.transfer, sha: m.sha });
        }
        if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND registered=1").get(m.project))
          throw new Error("Falta el proyecto sincronizado");
        if (incoming && incoming.transfer !== m.transfer) fs.rmSync(partial(incoming), { force: true });
        incoming = m;
      }
      const d = incoming;
      if (!d || d.transfer !== m.transfer) return;
      const file = partial(d);
      workspace();
      const present = fs.lstatSync(file, { throwIfNoEntry: false });
      if (present && (!present.isFile() || present.nlink !== 1)) throw new Error("La copia parcial no es regular.");
      let at = present?.size ?? 0;
      if (m.op === "chunk") {
        const data = Buffer.from(m.data, "base64");
        if (m.at !== at || !data.length || data.length > CHUNK || at + data.length > d.size)
          throw new Error("Fragmento inesperado");
        const fd = openRegular(
          file,
          fs.constants.O_WRONLY | fs.constants.O_APPEND | (present ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL),
        );
        try {
          writeAll(fd, data);
        } finally {
          fs.closeSync(fd);
        }
        at += data.length;
      }
      if (at > d.size) throw new Error("La copia parcial ha cambiado");
      if (at === d.size) await finish(ch, d, attempt);
      else ch.send({ op: "next", transfer: d.transfer, at });
    } catch {
      if (incoming?.transfer === m.transfer && attempt === generation) {
        workspace();
        fs.rmSync(partial(incoming), { force: true });
      }
      incoming = undefined;
      if (!disposed && attempt === generation) ch.send({ op: "failed", transfer: m.transfer });
    } finally {
      handling = false;
    }
  }
  return {
    status,
    select,
    selectCaptured,
    pump,
    receive,
    detach,
    dispose(remove: boolean) {
      disposed = true;
      detach();
      if (remove && fs.existsSync(dir) && samePath(realpath(dir), dir))
        fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type ProjectWork = ReturnType<typeof projectWork>;
