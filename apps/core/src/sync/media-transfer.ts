import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { z } from "zod";
import { reserveFolder } from "../backup/project-file-io.ts";
import { realpath } from "../paths.ts";
import { mediaDirectory, mediaStoragePath } from "../services/media-file.ts";
import {
  bytesAt,
  checkedDirectory,
  fingerprint,
  identity,
  inParent,
  openRegular,
  regularFile,
  sameFile,
  stamp,
} from "./continuous-folder-disk.ts";

export const MEDIA_CHUNK = 512 * 1024;
const maximum = Number.MAX_SAFE_INTEGER;
const position = z.number().int().min(0).max(maximum);
const id = z.string().min(1).max(512);
export const MediaRequest = z.object({ t: z.literal("pide"), id, at: position });
export const MediaBlock = z.object({
  t: z.literal("fichero"),
  id,
  at: position,
  data: z.base64().max(4 * Math.ceil(MEDIA_CHUNK / 3)),
  last: z.boolean(),
  missing: z.boolean(),
  sha: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
type Block = z.infer<typeof MediaBlock>;
type Frame = Block | z.infer<typeof MediaRequest>;
export type MediaPeer = { mediaDigests: boolean; send(frame: Frame): void };
const invalid = () => new Error("El archivo del adjunto ha cambiado o está fuera de su almacén.");
const info = (p: string) => regularFile(p, maximum);
const opened = (p: string, flags = fs.constants.O_RDONLY) => openRegular(p, flags, maximum);
type Media = { id: string; file: string; bytes: number };
type Stage = { dir: string; dirId: string; partId: string; file: string; signed: string | null };
type Pending = { media: Media; at: number; stage: Stage; link: MediaPeer };
const scratch = ".colonia-adjuntos";

export function mediaTransfer(
  db: DatabaseSync,
  home: string,
  peer: () => string | undefined,
  channel: () => MediaPeer | undefined,
  received: () => void,
  warn: (e: unknown) => void,
) {
  const base = realpath(home),
    store = path.join(base, "media");
  let prepared = false;
  const ensureTables = () => {
    if (prepared) return;
    db.exec(
      "CREATE TABLE IF NOT EXISTS sync_media_parts(peer TEXT NOT NULL,id TEXT NOT NULL,destination TEXT NOT NULL,dir TEXT NOT NULL,dir_id TEXT NOT NULL,part_id TEXT NOT NULL,sha TEXT,PRIMARY KEY(peer,id))",
    );
    prepared = true;
  };
  function record(key: string, create: boolean): Media {
    const row = db.prepare("SELECT path,bytes FROM media WHERE id=?").get(key);
    if (
      typeof row?.path !== "string" ||
      !path.isAbsolute(row.path) ||
      typeof row.bytes !== "number" ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0
    )
      throw invalid();
    return { id: key, file: mediaStoragePath(home, row.path, create ? "create" : "existing"), bytes: row.bytes };
  }
  const stageDir = () => {
    mediaDirectory(store, true);
    const dir = path.join(store, scratch);
    mediaDirectory(dir, true);
    return dir;
  };
  function safePart(stage: Stage) {
    const parent = stageDir();
    if (
      path.dirname(stage.dir) !== parent ||
      !/^parte-[a-zA-Z0-9]+$/.test(path.basename(stage.dir)) ||
      checkedDirectory(stage.dir) !== stage.dirId
    )
      throw invalid();
    const st = info(stage.file);
    if (!st || identity(st) !== stage.partId) throw invalid();
    return st;
  }
  function stored(key: string, who: string) {
    ensureTables();
    const row = db
      .prepare("SELECT destination,dir,dir_id,part_id,sha FROM sync_media_parts WHERE peer=? AND id=?")
      .get(who, key);
    if (!row) return undefined;
    const dir = String(row.dir);
    const stage: Stage = {
      dir,
      dirId: String(row.dir_id),
      partId: String(row.part_id),
      file: path.join(dir, "contenido"),
      signed: row.sha === null ? null : String(row.sha),
    };
    return { stage, dest: String(row.destination) };
  }
  function discard(key: string, who: string, stage: Stage) {
    safePart(stage);
    inParent(stage.file, (p) => fs.unlinkSync(p));
    finished(key, who, stage);
  }
  function finished(key: string, who: string, stage: Stage) {
    db.prepare("DELETE FROM sync_media_parts WHERE peer=? AND id=? AND dir_id=?").run(who, key, stage.dirId);
    if (checkedDirectory(stage.dir) === stage.dirId) {
      try {
        fs.rmdirSync(stage.dir);
      } catch {
        /* Un archivo ajeno en esta carpeta se conserva. */
      }
    }
  }
  function buildStage(m: Media, who: string) {
    ensureTables();
    let old = stored(m.id, who);
    const forgetOld = () => {
      db.prepare("DELETE FROM sync_media_parts WHERE peer=? AND id=?").run(who, m.id);
      old = undefined;
    };
    if (old) {
      const owned =
        path.dirname(old.stage.dir) === stageDir() && /^parte-[a-zA-Z0-9]+$/.test(path.basename(old.stage.dir));
      const dir = owned ? fs.lstatSync(old.stage.dir, { throwIfNoEntry: false }) : undefined;
      if (!dir?.isDirectory() || checkedDirectory(old.stage.dir) !== old.stage.dirId) forgetOld();
    }
    if (old) {
      // Al cortarse entre crear el enlace y quitar el temporal, sólo se retira nuestro propio nombre.
      const a = fs.lstatSync(old.stage.file, { bigint: true, throwIfNoEntry: false });
      const b = fs.lstatSync(m.file, { bigint: true, throwIfNoEntry: false });
      if (
        a &&
        b &&
        a.isFile() &&
        b.isFile() &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.nlink === 2n &&
        identity(a) === old.stage.partId &&
        old.dest === m.file
      ) {
        inParent(old.stage.file, (p) => fs.unlinkSync(p));
        finished(m.id, who, old.stage);
        return;
      }
      if (!a) {
        finished(m.id, who, old.stage);
      } else if (!a.isFile() || a.nlink !== 1n || identity(a) !== old.stage.partId) {
        forgetOld(); // Una sustitución pertenece a quien la hizo; se reserva otro temporal.
      } else if (old.dest === m.file) {
        safePart(old.stage);
        return old.stage;
      } else discard(m.id, who, old.stage);
    }
    if (fs.lstatSync(m.file, { throwIfNoEntry: false })) return;
    const dir = reserveFolder(stageDir(), "parte-"),
      file = path.join(dir, "contenido");
    const fd = fs.openSync(file, "wx", 0o600);
    let partId: string;
    try {
      partId = identity(fs.fstatSync(fd, { bigint: true }));
    } finally {
      fs.closeSync(fd);
    }
    const stage: Stage = { dir, file, dirId: checkedDirectory(dir), partId, signed: null };
    db.prepare("INSERT INTO sync_media_parts(peer,id,destination,dir,dir_id,part_id,sha) VALUES(?,?,?,?,?,?,NULL)").run(
      who,
      m.id,
      m.file,
      dir,
      stage.dirId,
      partId,
    );
    return stage;
  }
  let wanted = new Set<string>(),
    fetching: Pending | undefined,
    busy = false;
  let scanGeneration = 0;
  let failedHash = new Set<string>();
  let reading: MediaPeer | undefined;
  let source: { link: MediaPeer; id: string; file: string; stamp: string; sha?: string; next: number } | undefined;
  const clear = () => {
    scanGeneration++;
    wanted = new Set();
    fetching = undefined;
    source = undefined;
    reading = undefined;
    failedHash = new Set();
  };
  function want(key: string) {
    if (!channel() || wanted.has(key) || fetching?.media.id === key) return;
    try {
      const m = record(key, true);
      if (fs.lstatSync(m.file, { throwIfNoEntry: false }) && !stored(key, peer() ?? "")) return;
      wanted.add(key);
      pump();
    } catch (error) {
      warn(error);
    }
  }
  async function missing() {
    const link = channel();
    if (!link) return;
    const generation = ++scanGeneration;
    const query = db.prepare("SELECT id FROM media WHERE id>? ORDER BY id LIMIT 64");
    let after = "";
    try {
      while (channel() === link && generation === scanGeneration) {
        const rows = query.all(after);
        for (const row of rows) {
          after = String(row.id);
          want(after);
        }
        if (rows.length < 64) return;
        await yieldTurn();
      }
    } catch (err) {
      warn(err);
    }
  }
  function pump() {
    const link = channel(),
      who = peer();
    if (!link || !who || fetching || busy) return;
    for (const key of wanted) {
      wanted.delete(key);
      try {
        const media = record(key, true),
          stage = buildStage(media, who);
        if (!stage || fs.lstatSync(media.file, { throwIfNoEntry: false })) continue;
        const st = safePart(stage);
        const at = link.mediaDigests && stage.signed && st.size <= BigInt(media.bytes) ? Number(st.size) : 0;
        fetching = { media, stage, at, link };
        link.send({ t: "pide", id: key, at });
        return;
      } catch (error) {
        warn(error);
      }
    }
  }
  async function send(link: MediaPeer, key: string, requested: number) {
    if (channel() !== link || reading === link) return;
    reading = link;
    try {
      const m = record(key, false),
        s = info(m.file);
      if (!s || s.size !== BigInt(m.bytes)) throw invalid();
      const current = stamp(s);
      const previous = source;
      let state =
        previous?.link === link && previous.id === key && previous.file === m.file && previous.stamp === current
          ? previous
          : undefined;
      if (!state) {
        state = { link, id: key, file: m.file, stamp: current, next: 0 };
        if (link.mediaDigests)
          state.sha = (
            await fingerprint(
              m.file,
              "",
              () => {
                if (channel() !== link) throw invalid();
              },
              maximum,
            )
          ).sha;
        if (channel() !== link) return;
        source = state;
      }
      const at = requested > m.bytes || (!link.mediaDigests && requested !== state.next) ? 0 : requested;
      const { fd, before } = opened(m.file);
      try {
        if (stamp(before) !== current || record(key, false).file !== m.file) throw invalid();
        const data = bytesAt(fd, at, Math.min(MEDIA_CHUNK, m.bytes - at));
        if (!sameFile(fd, m.file, before, maximum) || channel() !== link) throw invalid();
        state.next = at + data.length;
        link.send({
          t: "fichero",
          id: key,
          at,
          data: data.toString("base64"),
          last: state.next === m.bytes,
          missing: false,
          ...(state.sha ? { sha: state.sha } : {}),
        });
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      if (channel() === link) link.send({ t: "fichero", id: key, at: 0, data: "", last: true, missing: true });
    } finally {
      if (reading === link) reading = undefined;
    }
  }
  async function receive(link: MediaPeer, m: Block) {
    const job = fetching,
      who = peer();
    if (busy || !job || !who || job.link !== link || job.media.id !== m.id || channel() !== link) return;
    busy = true;
    let requestingMore = false;
    const active = () => {
      if (channel() !== link || job !== fetching || peer() !== who) throw invalid();
    };
    try {
      const media = record(m.id, false);
      if (media.file !== job.media.file || media.bytes !== job.media.bytes) throw invalid();
      if (m.missing) {
        discard(m.id, who, job.stage);
        return;
      }
      if (link.mediaDigests && !m.sha) throw invalid();
      if (m.at !== job.at && m.at !== 0) throw invalid();
      const data = Buffer.from(m.data, "base64");
      if (
        data.length > MEDIA_CHUNK ||
        m.at + data.length > media.bytes ||
        m.last !== (m.at + data.length === media.bytes) ||
        (!data.length && !m.last)
      )
        throw invalid();
      const stage = job.stage;
      safePart(stage);
      const { fd, before } = opened(stage.file, fs.constants.O_RDWR);
      try {
        if (identity(before) !== stage.partId) throw invalid();
        if (m.at && (before.size !== BigInt(m.at) || stage.signed !== (m.sha ?? null))) {
          fs.ftruncateSync(fd, 0);
          job.at = 0;
          job.stage.signed = null;
          requestingMore = true;
          link.send({ t: "pide", id: m.id, at: 0 });
          return;
        }
        if (!m.at) {
          fs.ftruncateSync(fd, 0);
          stage.signed = m.sha ?? null;
          db.prepare("UPDATE sync_media_parts SET sha=? WHERE peer=? AND id=? AND dir_id=?").run(
            stage.signed,
            who,
            m.id,
            stage.dirId,
          );
        }
        for (let n = 0; n < data.length; ) {
          const written = fs.writeSync(fd, data, n, data.length - n, m.at + n);
          if (!written) throw invalid();
          n += written;
        }
        if (m.last) fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      job.at = m.at + data.length;
      if (!m.last) {
        requestingMore = true;
        link.send({ t: "pide", id: m.id, at: job.at });
        return;
      }
      const verified = stamp(safePart(stage));
      if (m.sha && (await fingerprint(stage.file, "", active, maximum)).sha !== m.sha) {
        active();
        discard(m.id, who, stage);
        if (!failedHash.has(m.id)) {
          failedHash.add(m.id);
          wanted.add(m.id);
        }
        throw invalid();
      }
      active();
      const bound = record(m.id, false);
      const remains = safePart(stage);
      if (
        bound.file !== media.file ||
        bound.bytes !== media.bytes ||
        remains.size !== BigInt(media.bytes) ||
        stamp(remains) !== verified
      )
        throw invalid();
      // Link es exclusivo y atómico. Un destino recién ocupado conserva sus datos, y la parte verificada queda pendiente.
      inParent(stage.file, (part) => inParent(media.file, (target) => fs.linkSync(part, target)));
      const a = fs.lstatSync(stage.file, { bigint: true }),
        b = fs.lstatSync(media.file, { bigint: true });
      if (
        !a.isFile() ||
        !b.isFile() ||
        a.nlink !== 2n ||
        identity(a) !== stage.partId ||
        a.dev !== b.dev ||
        a.ino !== b.ino
      )
        throw invalid();
      inParent(stage.file, (part) => fs.unlinkSync(part));
      finished(m.id, who, stage);
      failedHash.delete(m.id);
      received();
    } catch (error) {
      if (fetching === job) fetching = undefined;
      warn(error);
    } finally {
      busy = false;
      if (fetching === job && !requestingMore) fetching = undefined;
      pump();
    }
  }
  function forget(who: string | undefined) {
    clear();
    if (!who || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_media_parts'").get()) return;
    for (const row of db.prepare("SELECT id FROM sync_media_parts WHERE peer=?").all(who)) {
      const key = String(row.id);
      try {
        const prior = stored(key, who);
        if (prior) discard(key, who, prior.stage);
      } catch {
        // El dueño pudo mover, completar o sustituir el temporal. No se borra lo que ya no reconocemos.
        db.prepare("DELETE FROM sync_media_parts WHERE peer=? AND id=?").run(who, key);
      }
    }
  }
  return { want, missing, pump, send, receive, clear, forget };
}
