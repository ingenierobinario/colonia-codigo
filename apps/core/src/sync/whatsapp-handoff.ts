import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  durableJson,
  IMPORT_MARKER,
  linkedSession,
  readPrivateFile,
  readSessionAsync,
  SessionFiles,
  safeDirectory,
  sessionIdentity,
  syncDirectory,
  validateSession,
  writeSessionFiles,
} from "../channels/whatsapp-session-files.ts";
import type { SecretsPort } from "./journal.ts";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const tx = z.uuid();
export const WhatsAppHandoffMessage = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("offer"),
    channels: z.array(z.object({ id, identity: hash })).max(100),
    empty: z.array(id).max(100),
  }),
  z.object({ op: z.literal("request"), id, tx, identity: hash }),
  z.object({ op: z.literal("session"), id, tx, files: SessionFiles }),
  z.object({ op: z.literal("received"), id, tx }),
]);
type Message = z.infer<typeof WhatsAppHandoffMessage>;
const Record = z.object({
  phase: z.enum(["prepared", "releasing", "released", "owned"]),
  peer: hash,
  local: hash,
  tx,
  identity: hash,
  confirmed: z.boolean().optional(),
});
type Record = z.infer<typeof Record>;
type Link = { local: string; peer: string; send(message: Message): void };
export const HANDOFF_DIRECTORY = "whatsapp-handoff";
const KEY = "sync.whatsapp-escrow";

/** Session ownership is durable and independent of the synchronization role's wall clock. */
export function whatsappHandoff(d: {
  home: string;
  secrets: SecretsPort;
  channels(): Array<{ id: string; type: string; enabled: boolean }>;
  primary(): boolean;
  paired(): boolean;
  changed(): void;
}) {
  const root = path.join(d.home, HANDOFF_DIRECTORY);
  const checkRoots = () => {
    safeDirectory(d.home);
    safeDirectory(root, true);
    safeDirectory(path.join(d.home, "channels"), true);
  };
  const warm = new Set<string>();
  const records = new Map<string, Record>();
  let link: Link | undefined;
  let closed = false;
  let epoch = 0;
  let supported: boolean | undefined;
  let receiving: Promise<void> = Promise.resolve();
  const queued = new Set<string>();
  let ticking: Promise<void> | undefined;
  let escrowKey: Buffer | undefined;
  const sending = new Map<string, Promise<void>>();
  let empty = new Set<string>();
  const identities = new Map<string, string>();
  let offers: Array<{ id: string; identity: string }> = [];
  const stem = (channel: string) => createHash("sha256").update(id.parse(channel)).digest("hex");
  const file = (channel: string) => path.join(root, `${stem(channel)}.json`);
  const escrow = (channel: string) => path.join(root, `${stem(channel)}.sealed`);
  const directory = (channel: string) => path.join(d.home, "channels", id.parse(channel));
  function record(channel: string): Record | undefined {
    checkRoots();
    if (records.has(channel)) return records.get(channel);
    if (!fs.existsSync(file(channel))) return;
    const value = Record.parse(JSON.parse(readPrivateFile(file(channel))));
    records.set(channel, value);
    return value;
  }
  function save(channel: string, value: Record) {
    durableJson(file(channel), value);
    records.set(channel, value);
  }
  const configured = (channel: string) =>
    d.channels().some((c) => c.id === channel && c.enabled && c.type === "whatsapp");
  function current(channel: string, r: Record, expected: number) {
    return (
      epoch === expected &&
      !closed &&
      d.paired() &&
      configured(channel) &&
      link?.peer === r.peer &&
      link.local === r.local &&
      record(channel)?.tx === r.tx
    );
  }
  function key() {
    if (escrowKey) return escrowKey;
    let value = d.secrets.resolve(`secret://${KEY}`);
    if (!value) {
      value = randomBytes(32).toString("base64");
      d.secrets.set(KEY, value);
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== 32) throw new Error("Invalid WhatsApp handoff key");
    escrowKey = bytes;
    return bytes;
  }
  const aad = (channel: string, r: Record) => Buffer.from(JSON.stringify([channel, r.local, r.peer, r.tx, r.identity]));
  function seal(channel: string, r: Record, files: SessionFiles) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), nonce);
    cipher.setAAD(aad(channel, r));
    const data = Buffer.concat([cipher.update(JSON.stringify(files)), cipher.final()]);
    durableJson(escrow(channel), {
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    });
  }
  function unseal(channel: string, r: Record) {
    const value = JSON.parse(readPrivateFile(escrow(channel), 24 * 1024 * 1024));
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(value.nonce, "base64"));
    cipher.setAAD(aad(channel, r));
    cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return validateSession(
      JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, "base64")), cipher.final()]).toString("utf8")),
    ).files;
  }
  async function relinquish(channel: string) {
    // The durable released record prevents all future starts, including when this device becomes principal.
    if (warm.has(channel)) throw new Error("WhatsApp session has been opened in this process");
    const dir = directory(channel);
    if (fs.existsSync(dir)) {
      safeDirectory(dir);
      await fs.promises.rm(dir, { recursive: true });
      syncDirectory(path.dirname(dir));
    }
  }
  function sendReleased(channel: string, r: Record): Promise<void> {
    const pending = sending.get(channel);
    if (pending) return pending;
    const operation = (async () => {
      const expected = epoch;
      if (!current(channel, r, expected) || r.confirmed) return;
      const files = unseal(channel, r);
      await relinquish(channel);
      if (current(channel, r, expected)) link?.send({ op: "session", id: channel, tx: r.tx, files });
    })();
    sending.set(channel, operation);
    void operation.finally(() => sending.delete(channel)).catch(() => {});
    return operation;
  }
  async function importSession(channel: string, r: Record, input: SessionFiles, expected: number) {
    if (warm.has(channel)) throw new Error("An active WhatsApp session cannot be replaced");
    checkRoots();
    const snapshot = validateSession(input);
    if (snapshot.identity !== r.identity) throw new Error("WhatsApp session identity changed during handoff");
    const target = directory(channel);
    const marker = path.join(target, IMPORT_MARKER);
    if (fs.existsSync(marker)) {
      const previous = JSON.parse(readPrivateFile(marker));
      if (
        previous.tx === r.tx &&
        previous.digest === snapshot.digest &&
        (await readSessionAsync(target)).digest === snapshot.digest
      ) {
        if (!current(channel, r, expected)) throw new Error("WhatsApp pairing changed during handoff");
        save(channel, { ...r, phase: "owned" });
        return;
      }
    }
    if (linkedSession(target)) throw new Error("The destination already owns a WhatsApp session");
    const stage = path.join(root, `incoming-${r.tx}`);
    if (fs.existsSync(stage)) {
      safeDirectory(stage);
      await fs.promises.rm(stage, { recursive: true });
    }
    fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
    await writeSessionFiles(stage, snapshot.files);
    durableJson(path.join(stage, IMPORT_MARKER), { tx: r.tx, digest: snapshot.digest });
    checkRoots();
    if (!current(channel, r, expected)) throw new Error("WhatsApp pairing changed during handoff");
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Unsafe WhatsApp destination");
      fs.renameSync(target, path.join(root, `unlinked-${r.tx}`));
    }
    if (!current(channel, r, expected)) throw new Error("WhatsApp pairing changed during handoff");
    fs.renameSync(stage, target);
    syncDirectory(path.dirname(target));
    syncDirectory(root);
    save(channel, { ...r, phase: "owned" });
  }
  return {
    /** A cold-only boundary: stopping a live Baileys socket alone does not prove all auth writes drained. */
    canStart(channel: string): boolean {
      if (closed) return false;
      const r = record(channel);
      if (r && r.phase !== "owned") return false;
      return (
        !d.paired() ||
        supported === false ||
        warm.has(channel) ||
        empty.has(channel) ||
        linkedSession(directory(channel))
      );
    },
    starting(channel: string) {
      warm.add(channel);
    },
    attach(next: Link | undefined, compatible?: boolean) {
      if (closed) return;
      epoch++;
      link = next;
      supported = compatible;
      if (compatible === false) d.changed();
      offers = [];
      empty = new Set();
    },
    async close() {
      closed = true;
      epoch++;
      link = undefined;
      await Promise.allSettled([receiving, ...(ticking ? [ticking] : []), ...sending.values()]);
    },
    tick(): Promise<void> {
      if (closed) return Promise.resolve();
      if (ticking) return ticking;
      const task = tickNow();
      ticking = task;
      void task
        .finally(() => {
          if (ticking === task) ticking = undefined;
        })
        .catch(() => {});
      return task;
    },
    receive(peer: string, input: Message): Promise<void> {
      if (closed) return Promise.resolve();
      const key = `${peer}:${input.op}:${"id" in input ? input.id : ""}:${"tx" in input ? input.tx : ""}`;
      if (queued.has(key)) return Promise.resolve();
      queued.add(key);
      const expected = epoch;
      const next = receiving.then(() => receiveMessage(peer, input, expected)).finally(() => queued.delete(key));
      receiving = next.catch(() => {});
      return next;
    },
  };
  async function tickNow() {
    if (!link) return;
    const expected = epoch;
    const channels = d.channels().filter((c) => c.enabled && c.type === "whatsapp");
    for (const c of channels) {
      const r = record(c.id);
      if (r?.phase === "released") await sendReleased(c.id, r);
      if (epoch !== expected || !link) return;
    }
    if (!d.primary()) {
      const available: Array<{ id: string; identity: string }> = [];
      const absent: string[] = [];
      for (const c of channels) {
        const r = record(c.id);
        if (r?.phase === "released") {
          continue;
        }
        if (warm.has(c.id) || (r && r.phase !== "owned" && r.phase !== "releasing")) continue;
        if (!linkedSession(directory(c.id))) {
          absent.push(c.id);
          continue;
        }
        const identity =
          identities.get(c.id) ?? sessionIdentity(readPrivateFile(path.join(directory(c.id), "creds.json")));
        if (!identity) continue;
        identities.set(c.id, identity);
        available.push({ id: c.id, identity });
      }
      link.send({ op: "offer", channels: available, empty: absent });
    } else {
      for (const offer of offers) {
        if (!configured(offer.id) || warm.has(offer.id) || linkedSession(directory(offer.id))) continue;
        let r = record(offer.id);
        if (r && (r.peer !== link.peer || r.local !== link.local)) continue;
        if (!r || r.phase === "released") {
          r = { phase: "prepared", local: link.local, peer: link.peer, tx: randomUUID(), identity: offer.identity };
          save(offer.id, r);
        }
        if (r.phase === "prepared" && r.identity === offer.identity)
          link.send({ op: "request", id: offer.id, tx: r.tx, identity: r.identity });
      }
    }
  }
  async function receiveMessage(peer: string, input: Message, expected: number): Promise<void> {
    if (!link || peer !== link.peer || epoch !== expected) return;
    const m = WhatsAppHandoffMessage.parse(input);
    if (m.op === "offer") {
      if (d.primary()) {
        offers = m.channels;
        const changed = m.empty.some((channel) => !empty.has(channel));
        empty = new Set(m.empty);
        if (changed) d.changed();
      }
      return;
    }
    if (!configured(m.id)) return;
    const r = record(m.id);
    if (m.op === "received") {
      if (r?.phase === "released" && r.peer === peer && r.local === link.local && r.tx === m.tx) {
        save(m.id, { ...r, confirmed: true });
        fs.rmSync(escrow(m.id), { force: true });
      }
      return;
    }
    if (m.op === "request") {
      if (d.primary() || warm.has(m.id)) return;
      if (r?.phase === "released") {
        if (r.peer === peer && r.local === link.local && r.tx === m.tx) await sendReleased(m.id, r);
        return;
      }
      if (
        r &&
        r.phase !== "owned" &&
        !(r.phase === "releasing" && r.peer === peer && r.local === link.local && r.tx === m.tx)
      )
        return;
      const reservation: Record = { phase: "releasing", local: link.local, peer, tx: m.tx, identity: m.identity };
      save(m.id, reservation);
      const snapshot = await readSessionAsync(directory(m.id));
      if (snapshot.identity !== m.identity || !current(m.id, reservation, expected)) return;
      const released: Record = { phase: "released", local: reservation.local, peer, tx: m.tx, identity: m.identity };
      seal(m.id, released, snapshot.files);
      save(m.id, released);
      await sendReleased(m.id, released);
      return;
    }
    if (
      !r ||
      r.peer !== peer ||
      r.local !== link.local ||
      r.tx !== m.tx ||
      (r.phase !== "prepared" && r.phase !== "owned")
    )
      return;
    if (r.phase === "prepared") {
      await importSession(m.id, r, m.files, expected);
      d.changed();
    }
    if (link?.peer === peer && epoch === expected) link.send({ op: "received", id: m.id, tx: m.tx });
  }
}
export type WhatsAppHandoff = ReturnType<typeof whatsappHandoff>;
