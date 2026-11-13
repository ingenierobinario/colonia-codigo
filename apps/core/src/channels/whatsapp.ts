// WhatsApp on the owner's own account, as a linked device (Baileys). The owner talks to their agent in "Message
// yourself"; anyone else is a contact the owner approved, and nobody else ever gets an answer from the owner's number.
// The library loads with the first WhatsApp channel; the credentials folder IS the account (kept at 0700).
// See DECISIONS.md#d-025
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_LIMITS } from "@colonia/protocol";
import type { Inbound, Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { chunks } from "./telegram-format.ts";
import {
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  type HistoryMessage,
  type OutFile,
  type Recovered,
  SendError,
} from "./types.ts";
import { type Menu, menuText, optionNamed, readMenu, tapFor, WA_CONTAINERS } from "./whatsapp-menus.ts";

/** The part of the library Colonia uses, so a test can hand in its own. */
export type WaLib = {
  makeWASocket(opts: Record<string, unknown>): WaSocket;
  useMultiFileAuthState(dir: string): Promise<{ state: unknown; saveCreds: () => Promise<void> | void }>;
  downloadMediaMessage(
    msg: WaMessage,
    type: "buffer",
    opts: Record<string, unknown>,
    ctx?: { logger: unknown; reuploadRequest: (m: WaMessage) => Promise<WaMessage> },
  ): Promise<Buffer>;
  fetchLatestBaileysVersion?(): Promise<{ version: number[] }>;
  Browsers?: { macOS(name: string): [string, string, string] };
  DisconnectReason: { loggedOut: number; restartRequired: number; timedOut: number };
};
export type WaSocket = {
  ev: { on(event: string, listener: (arg: never) => void): void };
  user?: { id: string; lid?: string } | undefined;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string | null } } | undefined>;
  sendPresenceUpdate(type: "composing" | "paused", jid?: string): Promise<void>;
  logout(): Promise<void>;
  end(err?: Error): void;
  /** Where someone's profile picture is (none when they hide it). */
  profilePictureUrl?(jid: string, type: "image" | "preview"): Promise<string | undefined>;
  /** Asks to hear when someone comes online or leaves (until the connection closes). */
  presenceSubscribe?(jid: string): Promise<void>;
  /** Asks the sender's phone to upload an expired file again (its download link is old). */
  updateMediaMessage?(m: WaMessage): Promise<WaMessage>;
  /**
   * PROPIOS-6: asks the owner's phone for up to `count` messages of a chat written before the one given (its time in
   * milliseconds); they come back through `messaging-history.set`.
   */
  fetchMessageHistory?(count: number, oldest: WaKey, oldestTimestampMs: number): Promise<string | undefined>;
  /** Asks the owner's phone to send one message again; it comes back through `messages.upsert`. */
  requestPlaceholderResend?(key: WaKey): Promise<string | undefined>;
  /** A private id's phone number (and the other way round), when WhatsApp told it. */
  signalRepository?: {
    lidMapping?: {
      getPNForLID?(lid: string): Promise<string | null | undefined>;
      getLIDForPN?(pn: string): Promise<string | null | undefined>;
    };
  };
};
export type WaKey = {
  id?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
};
/** A file's size as the library hands it: a number, or a protobuf Long. */
type WaLength = number | { toNumber(): number } | null | undefined;
type WaFile = { mimetype?: string | null; fileLength?: WaLength };
type WaCard = { displayName?: string | null; vcard?: string | null };
type WaPlace = {
  degreesLatitude?: number | null;
  degreesLongitude?: number | null;
  name?: string | null;
  address?: string | null;
};
export type WaContent = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: (WaFile & { caption?: string | null }) | null;
  videoMessage?: (WaFile & { caption?: string | null }) | null;
  /** A round video note. */
  ptvMessage?: WaFile | null;
  documentMessage?: (WaFile & { caption?: string | null; fileName?: string | null }) | null;
  audioMessage?: { ptt?: boolean | null; mimetype?: string | null } | null;
  stickerMessage?: WaFile | null;
  /** A contact card someone shared (one, or several at once). */
  contactMessage?: WaCard | null;
  contactsArrayMessage?: { contacts?: (WaCard | null)[] | null } | null;
  locationMessage?: WaPlace | null;
  liveLocationMessage?: WaPlace | null;
  /** An emoji on a message (`key.id`); empty text when it was taken off. */
  reactionMessage?: { key?: WaKey | null; text?: string | null } | null;
  ephemeralMessage?: { message?: WaContent | null } | null;
  viewOnceMessage?: { message?: WaContent | null } | null;
  viewOnceMessageV2?: { message?: WaContent | null } | null;
};
export type WaMessage = {
  key: WaKey;
  pushName?: string | null;
  /** A verified business's name: such accounts send it instead of `pushName`. */
  verifiedBizName?: string | null;
  /** Set when the message arrived without content (it could not be decrypted). */
  messageStubType?: number | null;
  /** When it was written, in seconds. */
  messageTimestamp?: WaLength;
  message?: WaContent | null;
};
/** A send of ours moving on: 3 on their device, 4 read, 5 a voice note played. */
type WaUpdate = { key: WaKey; update: { status?: number | null } };
type WaPresence = { id: string; presences: Record<string, { lastKnownPresence?: string; lastSeen?: number }> };
type ConnectionUpdate = {
  connection?: "open" | "close" | "connecting";
  qr?: string;
  lastDisconnect?: { error?: { message?: string; output?: { statusCode?: number } } };
};

const loadBaileys = async () => (await import("@whiskeysockets/baileys")) as unknown as WaLib;

/** Voice notes up to this size are downloaded for transcription. */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
/** Recent incoming messages whose chat is remembered for a reaction. */
const CHATS_KEPT = 500;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Rounds of QR codes (about a minute each) before linking waits for the owner to press Link again. */
const QR_ROUNDS = 4;
/** Our own sends come back as echoes within seconds; this only has to outlive that, bounded. */
const ECHOES = 500;
/** An echo of our send can beat sendMessage's answer by a moment; the owner's own message waits this long first. */
const ECHO_WAIT_MS = 1_500;
// WhatsApp's own service numbers (verification codes, product tips): never someone writing.
const SERVICE = new Set(["16505361212", "16508638904"]);
/** How long the phone has to send messages again under one address before the next one is tried. */
const RESEND_WAIT_MS = 12_000;
/** PROPIOS-6: after connecting, how long before the phone is asked for each kept chat's earlier messages. */
const HISTORY_WAIT_MS = 30_000;
/** PROPIOS-6: between two such requests, and after our last send, so they never stand in the way of a send. */
const HISTORY_GAP_MS = 4_000;
/** PROPIOS-6: earlier messages asked per chat, and chats asked per connection (the rest, on the next one). */
const HISTORY_COUNT = 50;
const HISTORY_CHATS = 40;
/** PROPIOS-6: the chats already asked for their earlier messages, kept with the linked device (a new link asks again). */
const HISTORY_ASKED = "colonia-history-asked.json";

/** `5491100000000:12@s.whatsapp.net` → `5491100000000@s.whatsapp.net` (the device suffix is not the person). */
export const normalJid = (jid: string | null | undefined): string => {
  const s = String(jid ?? "").toLowerCase();
  const at = s.indexOf("@");
  if (at < 1) return "";
  return `${s.slice(0, at).split(":")[0]}@${s.slice(at + 1)}`;
};
const isPhone = (jid: string) => jid.endsWith("@s.whatsapp.net");
const digitsOf = (jid: string) => jid.split("@")[0] ?? "";
const ignorable = (jid: string) =>
  !jid ||
  jid.endsWith("@broadcast") ||
  jid.endsWith("@newsletter") ||
  digitsOf(jid) === "0" ||
  SERVICE.has(digitsOf(jid));

/** The words of a message, its wrappers (disappearing, view once) opened. */
function unwrap(c: WaContent | null | undefined): WaContent | undefined {
  let cur = c ?? undefined;
  for (let i = 0; i < 6 && cur; i++) {
    const wrappers = cur as Record<string, { message?: WaContent | null } | null | undefined>;
    const inner = WA_CONTAINERS.map((k) => wrappers[k]?.message).find(Boolean);
    if (!inner) break;
    cur = inner;
  }
  return cur;
}
function textOf(c: WaContent): string | undefined {
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    menuText(c) ??
    sharedText(c)
  );
}

/** A shared contact card or place, as words: the agent needs the name and number, not the vCard. */
function sharedText(c: WaContent): string | undefined {
  const cards = c.contactMessage ? [c.contactMessage] : (c.contactsArrayMessage?.contacts ?? []);
  const shown = cards
    .filter((k): k is WaCard => Boolean(k))
    .map(cardText)
    .filter(Boolean);
  if (shown.length) return shown.join("\n");
  const place = c.locationMessage ?? c.liveLocationMessage;
  if (!place) return undefined;
  const at =
    typeof place.degreesLatitude === "number" && typeof place.degreesLongitude === "number"
      ? `${place.degreesLatitude}, ${place.degreesLongitude}`
      : "";
  const said = [place.name, place.address, at].map((v) => String(v ?? "").trim()).filter(Boolean);
  return said.length ? `[location: ${said.join(" · ").slice(0, 300)}]` : undefined;
}
function cardText(k: WaCard): string {
  const lines = String(k.vcard ?? "").split(/\r?\n/);
  const field = (name: string) =>
    lines.filter((l) => l.toUpperCase().startsWith(name)).map((l) => l.slice(l.indexOf(":") + 1).trim());
  const name = k.displayName?.trim() || field("FN")[0] || "";
  // `TEL;waid=549…:+54 9 …`: the number as written, after the parameters.
  const phones = [...new Set(field("TEL").filter(Boolean))];
  const emails = field("EMAIL").filter(Boolean);
  const said = [name, ...phones, ...emails].filter(Boolean);
  return said.length ? `[contact: ${said.join(", ").slice(0, 300)}]` : "";
}

/** A message's picture, video, sticker or document: what it is, the name it is kept under and its declared size. */
type WaMedia = { kind: "photo" | "video" | "sticker" | "file"; name: string; mime: string; size: number };
const sizeOf = (n: WaLength) => (typeof n === "number" ? n : n ? n.toNumber() : 0);
const extOf = (mime: string, fallback: string) =>
  ({ "video/quicktime": "mov", "video/3gpp": "3gp", "image/jpeg": "jpg" })[mime] ??
  (/^[a-z]+\/([a-z0-9]{2,5})$/.exec(mime)?.[1] || fallback);
function mediaOf(c: WaContent): WaMedia | undefined {
  const typed = (f: WaFile, fallback: string) => (f.mimetype ?? fallback).split(";")[0]?.trim() || fallback;
  const made = (kind: WaMedia["kind"], f: WaFile, fallback: string, base: string): WaMedia => {
    const mime = typed(f, fallback);
    return { kind, mime, name: `${base}.${extOf(mime, fallback.split("/")[1] ?? "bin")}`, size: sizeOf(f.fileLength) };
  };
  if (c.imageMessage) return made("photo", c.imageMessage, "image/jpeg", "photo");
  if (c.videoMessage) return made("video", c.videoMessage, "video/mp4", "video");
  if (c.ptvMessage) return made("video", c.ptvMessage, "video/mp4", "video");
  if (c.stickerMessage) return made("sticker", c.stickerMessage, "image/webp", "sticker");
  const d = c.documentMessage;
  if (!d) return undefined;
  const name = path.basename(String(d.fileName ?? "").replaceAll("\\", "/")).slice(0, 200) || "document";
  return { kind: "file", name, mime: typed(d, "application/octet-stream"), size: sizeOf(d.fileLength) };
}

/** Markdown as WhatsApp writes it: *bold*, _italic_, ~strike~, links as "text (url)". */
export function toWhatsApp(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
}

/** What the library logs, as one line: its message and the fields that say why (errors, codes). */
const line = (a: unknown[]) =>
  a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x, (_k, v) => (v instanceof Error ? v.message : v))))
    .join(" ")
    .slice(0, 400);
/** Linking and connection steps the library reports at info level: worth keeping, the rest of its info is noise. */
const LINKING = /pair|qr|login|connect|stream|logout|restart|regist/i;

/** A pino-shaped logger: warnings and errors, plus the library's linking steps (they explain a failed link). */
function quiet(log: Log | undefined) {
  const noop = () => {};
  const warn = (...a: unknown[]) => log?.warn({ wa: line(a) }, "whatsapp");
  const info = (...a: unknown[]) => {
    const text = line(a);
    if (LINKING.test(text)) log?.info({ wa: text }, "whatsapp");
  };
  const self: Record<string, unknown> = { level: "info", trace: noop, debug: noop, info, warn, error: warn };
  self.fatal = warn;
  self.child = () => self;
  return self;
}

export function whatsappAdapter(opts: {
  dir: string;
  /** The linked number is the owner's own phone: "Message yourself" is the owner talking. */
  selfOwner?: boolean;
  log?: Log;
  lib?: () => Promise<WaLib>;
  /** How long the phone has to send a message again (tests shorten it). */
  resendWaitMs?: number;
  /** How long a message sent from the owner's phone waits, in case it is the echo of our own send (tests shorten it). */
  echoWaitMs?: number;
  /** PROPIOS-6: the wait before asking for earlier messages, and between requests (tests shorten them). */
  historyWaitMs?: number;
  historyGapMs?: number;
}): ChannelAdapter {
  const { dir, log } = opts;
  let lib: WaLib | undefined;
  let sock: WaSocket | undefined;
  let io: AdapterIO | undefined;
  let me: { pn: string; lid: string } | undefined;
  let stopped = false;
  let attempts = 0;
  let qrRounds = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Credentials being written: a reconnect reads them back, so it waits for the last write. */
  let saving: Promise<unknown> = Promise.resolve();
  /** Ids of what we sent: their echoes are not the owner typing. */
  const ownSends = new Set<string>();
  /** The numbered options last offered in each conversation (WhatsApp has no buttons). */
  const offered = new Map<string, Array<{ id: string; label: string }>>();
  /** Who is online, by phone address; and the addresses asked about on this connection. */
  const seen = new Map<string, { online: boolean; last_seen?: string }>();
  const watching = new Set<string>();
  /** The chat each recent message came in on (WhatsApp's own id for it), to react to it exactly there. */
  const chats = new Map<string, string>();
  /** Messages asked of the phone again (recover), waiting for it to send them. */
  const resending = new Map<string, (m: WaMessage) => void>();
  /** The menu each chat's other side offered last (a business's buttons), so an answer naming an option taps it. */
  const menus = new Map<string, Menu>();
  /** PROPIOS-6: sends under way and when the last one ended: asking for history waits for both. */
  let sendsLive = 0;
  let lastSend = 0;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;

  const hasCreds = () => fs.existsSync(path.join(dir, "creds.json"));
  const remember = (id: string | null | undefined) => {
    if (!id) return;
    ownSends.add(id);
    while (ownSends.size > ECHOES) ownSends.delete(ownSends.values().next().value as string);
  };
  const isSelf = (jid: string) => Boolean(me && (jid === me.pn || jid === me.lid));
  /**
   * WA-LID-1: the one address a person has on this line (per connection: each line has its own mapping): the phone
   * number when the key brings it or this line's mapping knows it, the private id only when nothing tells the number.
   */
  async function canonicalJid(jid: string, alt: string | null | undefined, s = sock): Promise<string> {
    if (isPhone(jid)) return jid;
    const other = normalJid(alt);
    if (other && isPhone(other)) return other;
    if (!jid.endsWith("@lid")) return jid;
    const pn = normalJid(await s?.signalRepository?.lidMapping?.getPNForLID?.(jid)?.catch(() => undefined));
    return pn && isPhone(pn) ? pn : jid;
  }

  let connecting: Promise<void> = Promise.resolve();
  function connect(): Promise<void> {
    connecting = openSocket();
    return connecting;
  }

  async function openSocket(): Promise<void> {
    if (!lib || stopped) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await lib.useMultiFileAuthState(dir);
    let version: number[] | undefined;
    try {
      // An old protocol version is a reliable way to be disconnected: ask what WhatsApp speaks today.
      version = (await lib.fetchLatestBaileysVersion?.())?.version;
    } catch {}
    if (stopped) return;
    const s = lib.makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: quiet(log),
      // A web companion on macOS, as WhatsApp Web is. The second field picks the platform the phone links: anything
      // but a browser name (e.g. "Desktop", the native app) makes the phone start linking and then refuse it.
      browser: lib.Browsers?.macOS("Colonia") ?? ["Mac OS", "Colonia", "14.4.1"],
      // The phone stays the one that is online: announcing ourselves would mute its notifications.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = s;
    s.ev.on("creds.update", (() => {
      if (s !== sock || stopped) return;
      saving = saving.then(saveCreds, saveCreds);
    }) as (arg: never) => void);
    s.ev.on("connection.update", ((u: ConnectionUpdate) => onConnection(s, u)) as (arg: never) => void);
    s.ev.on("messages.upsert", ((up: { type: string; messages: WaMessage[] }) => {
      if (s !== sock) return;
      for (const m of up.messages) {
        // A message the phone sent again on request is that request's answer, not news.
        const asked = m.key.id ? resending.get(m.key.id) : undefined;
        if (asked) asked(m);
        // PROPIOS-3: what was written while this device was offline (a reconnection, the PC asleep) comes as
        // "append", not "notify": kept all the same, the owner's as theirs, the others' unread but unanswered.
        else if (up.type === "notify" || up.type === "append")
          void onMessage(m, up.type === "append").catch((err) => log?.warn({ err: errorMessage(err, 200) }, "whatsapp message not handled"));
      }
    }) as (arg: never) => void);
    // PROPIOS-6: the phone's own history (when the device links, or asked for a chat's earlier messages).
    s.ev.on("messaging-history.set", ((h: { messages?: WaMessage[] | null; syncType?: number | null }) => {
      if (s !== sock) return;
      void onHistory(s, h.messages ?? []).catch((err) =>
        log?.warn({ err: errorMessage(err, 200) }, "whatsapp history not handled"),
      );
    }) as (arg: never) => void);
    s.ev.on("messages.update", ((ups: WaUpdate[]) => {
      if (s !== sock) return;
      for (const u of ups) {
        const state = u.update.status === 3 ? "delivered" : (u.update.status ?? 0) >= 4 ? "read" : undefined;
        if (u.key.fromMe && u.key.id && state) io?.receipt?.(u.key.id, state);
      }
    }) as (arg: never) => void);
    s.ev.on("presence.update", ((p: WaPresence) => {
      if (s === sock) void onPresence(s, p).catch(() => {});
    }) as (arg: never) => void);
  }

  async function onPresence(s: WaSocket, p: WaPresence): Promise<void> {
    for (const [jid, v] of Object.entries(p.presences)) {
      let who = normalJid(jid);
      if (who.endsWith("@lid")) who = normalJid(await s.signalRepository?.lidMapping?.getPNForLID?.(who)) || who;
      if (!v.lastKnownPresence) continue;
      // Typing or recording is being there too.
      const online = v.lastKnownPresence !== "unavailable";
      const was = seen.get(who);
      const last = v.lastSeen ? new Date(v.lastSeen * 1000).toISOString() : online ? undefined : was?.last_seen;
      seen.set(who, { online, ...(last ? { last_seen: last } : {}) });
    }
  }

  function onConnection(s: WaSocket, u: ConnectionUpdate): void {
    if (s !== sock || stopped || !lib || !io) return;
    if (u.qr) io.qr?.(u.qr);
    if (u.connection === "open") {
      io.qr?.(undefined);
      // A new connection hears nobody until asked again.
      watching.clear();
      attempts = 0;
      qrRounds = 0;
      me = { pn: normalJid(s.user?.id), lid: normalJid(s.user?.lid) };
      io.status("running");
      io.identified?.({ account: `+${digitsOf(me.pn)}`, owner: me.pn });
      clearTimeout(historyTimer);
      historyTimer = setTimeout(
        () =>
          void askHistory(s).catch((err) =>
            log?.warn({ err: errorMessage(err, 200) }, "whatsapp earlier messages not asked"),
          ),
        opts.historyWaitMs ?? HISTORY_WAIT_MS,
      );
      historyTimer.unref?.();
      return;
    }
    if (u.connection !== "close") return;
    const code = u.lastDisconnect?.error?.output?.statusCode;
    const why = u.lastDisconnect?.error?.message ?? `closed (${code ?? "?"})`;
    if (code === lib.DisconnectReason.loggedOut) {
      // Dead credentials: retrying them in a loop is how an account gets flagged. A human links it again.
      void stop().then(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        me = undefined;
        io?.qr?.(undefined);
        io?.status("error", "WhatsApp logged this device out: link it again with the QR");
      });
      return;
    }
    // After a scan WhatsApp asks for a restart: the linked session comes up on the next connection.
    if (code === lib.DisconnectReason.restartRequired) {
      log?.info({ channel: "whatsapp" }, "whatsapp linked: reconnecting with the new credentials");
      void saving.then(connect, connect);
      return;
    }
    log?.warn({ code, why: why.slice(0, 200) }, "whatsapp connection closed");
    // Nobody scanned yet: a fresh round of codes, a few times, then wait for the owner.
    if (!hasCreds() && code === lib.DisconnectReason.timedOut && ++qrRounds < QR_ROUNDS) {
      void connect();
      return;
    }
    if (!hasCreds()) {
      io.qr?.(undefined);
      io.status("error", "The QR was not scanned in time: press Link to get a new one");
      return;
    }
    io.status("error", `WhatsApp disconnected: ${why}`.slice(0, 200));
    const wait = BACKOFF_MS[Math.min(attempts++, BACKOFF_MS.length - 1)] ?? 60_000;
    retry = setTimeout(() => void connect(), wait);
    retry.unref?.();
  }

  async function onMessage(m: WaMessage, offline = false): Promise<void> {
    if (!io || !me) return;
    const content = unwrap(m.message);
    const jid = normalJid(m.key.remoteJid);
    if (ignorable(jid) || !m.key.id) return;
    // What is dropped unread is logged by its shape (never its words), so a message that never showed can be traced.
    const server = jid.split("@")[1] ?? "";
    if (!content) {
      if (m.messageStubType) log?.warn({ server, stub: m.messageStubType }, "whatsapp message could not be decrypted");
      return;
    }
    const group = jid.endsWith("@g.us");
    // PROPIOS-1: the owner typing to a contact on the linked phone (or WhatsApp Web): kept in that chat, never a turn.
    let own = false;
    if (m.key.fromMe) {
      // Our own send coming back (the agent's answer, the owner's "I'll write"): already in the chat.
      // PROPIOS-3: the library's own copy of a send ("append") leaves the id for the echo that may still come.
      if (offline ? ownSends.has(m.key.id) : ownSends.delete(m.key.id)) return;
      // "Message yourself" is the owner talking to the agent only when the line is the owner's own phone.
      if (isSelf(jid)) {
        // A backlog of orders to the agent is not run late (PROPIOS-3).
        if (!opts.selfOwner || offline) return;
      } else {
        if (group || content.reactionMessage || !io.ownMessage) return;
        // The echo of our own send can come before sendMessage resolves and its id is remembered: wait, look again.
        await new Promise((r) => setTimeout(r, opts.echoWaitMs ?? ECHO_WAIT_MS));
        if ((offline ? ownSends.has(m.key.id) : ownSends.delete(m.key.id)) || !io || !me) return;
        own = true;
      }
    }
    // One person, one address: their phone number when WhatsApp tells it, their private id otherwise.
    // WA-LID-1: the same for both sides of a chat. What the contact writes and what the owner writes on the phone may
    // each name the chat by the number or by the private id (with or without the other beside it); both are brought
    // to the number with this line's own mapping, so the two halves of one conversation land in the same chat.
    let who = m.key.fromMe && !own ? me.pn : await canonicalJid(jid, m.key.remoteJidAlt);
    // PROPIOS-5: no number for that private id: the chat kept under the number will not be found. Traced by shape.
    if (who.endsWith("@lid"))
      log?.info({ server: "lid", own, offline }, "whatsapp message: no number for the private id");
    const name = m.key.fromMe ? "Owner" : m.verifiedBizName?.trim() || m.pushName?.trim() || `+${digitsOf(who)}`;
    const reacted = content.reactionMessage;
    if (reacted) {
      // Our own reactions come back as ours; only the other side's are news.
      if (!m.key.fromMe && reacted.key?.id)
        io.reaction?.({
          conversation: who,
          sender: { id: who, name: name.slice(0, 80) },
          target: reacted.key.id,
          emoji: reacted.text ?? "",
          private: !group,
        });
      return;
    }
    chats.set(m.key.id, jid);
    if (chats.size > CHATS_KEPT) chats.delete(chats.keys().next().value ?? "");
    // WA-TODO-1: when it was written, not when it got here: a backlog comes all at once, and the owner's own words
    // wait for their echo, so the order they are handed over in is not the order of the conversation.
    const secs = sizeOf(m.messageTimestamp);
    const at = secs ? new Date(secs * 1000).toISOString() : undefined;
    const audio = content.audioMessage;
    let text = textOf(content) ?? "";
    let voice: { mime: string; data: string } | undefined;
    if (audio && !group && lib) {
      try {
        const bytes = await lib.downloadMediaMessage(m, "buffer", {});
        if (bytes.length <= MAX_VOICE_BYTES)
          voice = {
            mime: (audio.mimetype ?? "audio/ogg").split(";")[0] ?? "audio/ogg",
            data: bytes.toString("base64"),
          };
      } catch (err) {
        log?.warn({ err: errorMessage(err, 200) }, "whatsapp voice note not downloaded");
      }
      if (!voice) text = "[voice note: it could not be downloaded]";
    }
    const media = mediaOf(content);
    let files: Inbound["files"];
    if (media && group) text ||= `[${media.kind}]`;
    else if (media) {
      const got = await fileOf(m, media);
      if (got.file) files = [media.kind === "sticker" ? { ...got.file, sticker: {} } : got.file];
      else text = `${text}\n[attachment could not be downloaded: ${got.failure}]`.trim();
    }
    if (!text && !voice && !files) {
      // PROPIOS-5: the owner's own words dropped here were silent; an echo of our send never gets this far.
      if (!m.key.fromMe || own)
        log?.warn({ server, own, kinds: Object.keys(content).slice(0, 8) }, "whatsapp message not read");
      return;
    }
    // The owner's own words: no menu read, no option pressed (a "1" they type is not a choice offered to them).
    if (own) {
      const kept = [
        ...(files ?? []),
        ...(voice ? [{ name: "Voice note.ogg", mime: voice.mime, data: voice.data }] : []),
      ];
      io.ownMessage?.({
        external_id: m.key.id,
        conversation: who,
        text,
        ...(kept.length ? { files: kept } : {}),
        ...(at ? { at } : {}),
      });
      return;
    }
    if (!group) {
      const menu = readMenu(content);
      menus.delete(who);
      if (menu?.options.length) menus.set(who, menu);
      if (menus.size > CHATS_KEPT) menus.delete(menus.keys().next().value ?? "");
    }
    // A number answering the options offered here is that option, pressed.
    const choice = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
    const options = offered.get(who);
    if (!offline && choice && options?.[Number(choice) - 1]) {
      offered.delete(who);
      io.action({ conversation: who, sender: { id: who, name }, data: options[Number(choice) - 1]?.id ?? "" });
      return;
    }
    io.receive({
      external_id: m.key.id,
      ref: m.key.id,
      conversation: who,
      sender: { id: who, name: name.slice(0, 80) },
      text,
      private: !group,
      ...(offline ? { late: true } : {}),
      ...(at ? { at } : {}),
      ...(voice ? { voice } : {}),
      ...(files ? { files } : {}),
    });
  }

  /**
   * PROPIOS-6: messages from the phone's history, read as live ones are (the same filters: no groups, no broadcasts or
   * service numbers, nothing of the owner's own "Message yourself") and handed over in one go; files are named, not
   * downloaded (old links are long gone). Colonia keeps those of the chats it already has.
   */
  async function onHistory(s: WaSocket, ms: WaMessage[]): Promise<void> {
    if (!io?.history || !me || !ms.length) return;
    const out: HistoryMessage[] = [];
    let dropped = 0;
    for (const m of ms) {
      const jid = normalJid(m.key.remoteJid);
      const content = unwrap(m.message);
      if (!m.key.id || ignorable(jid) || jid.endsWith("@g.us") || isSelf(jid) || !content || content.reactionMessage) {
        dropped++;
        continue;
      }
      const who = await canonicalJid(jid, m.key.remoteJidAlt, s);
      const media = mediaOf(content);
      const said = [
        textOf(content) ?? "",
        content.audioMessage ? "[voice note]" : media ? `[${media.kind === "file" ? media.name : media.kind}]` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      const secs = sizeOf(m.messageTimestamp);
      if (!said || isSelf(who) || !secs) {
        dropped++;
        continue;
      }
      if (!m.key.fromMe) chats.set(m.key.id, jid);
      out.push({
        external_id: m.key.id,
        conversation: who,
        own: Boolean(m.key.fromMe),
        ...(m.key.fromMe ? {} : { name: (m.verifiedBizName?.trim() || m.pushName?.trim() || "").slice(0, 80) || undefined }),
        text: said,
        at: new Date(secs * 1000).toISOString(),
      });
    }
    while (chats.size > CHATS_KEPT) chats.delete(chats.keys().next().value ?? "");
    // By its shape: how many came, how many were readable.
    log?.info({ given: ms.length, readable: out.length, dropped }, "whatsapp history");
    if (out.length && s === sock) io.history(out);
  }

  /** PROPIOS-6: the chats already asked for their earlier messages on this linked device. */
  const askedFile = () => path.join(dir, HISTORY_ASKED);
  function askedChats(): Set<string> {
    try {
      const v = JSON.parse(fs.readFileSync(askedFile(), "utf8")) as unknown;
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  }

  /**
   * PROPIOS-6: asks the phone, once per kept chat, for the messages written before the oldest one Colonia has (those
   * from before the device kept the owner's own words, or from before it was linked). One request at a time, spaced,
   * and never while a send is under way or just after one: the library sends each request as a message of its own.
   */
  async function askHistory(s: WaSocket): Promise<void> {
    const fetchHistory = s.fetchMessageHistory?.bind(s);
    if (!fetchHistory || !io?.keptChats) return;
    const asked = askedChats();
    const due = io.keptChats().filter((c) => !asked.has(c.conversation) && isPhone(c.conversation));
    const gap = opts.historyGapMs ?? HISTORY_GAP_MS;
    let n = 0;
    for (const c of due.slice(0, HISTORY_CHATS)) {
      // Sends go first: wait until none is under way and the last one is a moment behind.
      while (s === sock && !stopped && (sendsLive > 0 || Date.now() - lastSend < gap))
        await new Promise((r) => setTimeout(r, Math.max(50, Math.min(gap, 1_000))));
      if (s !== sock || stopped || !me) return;
      const at = Date.parse(c.oldest.at);
      if (!Number.isFinite(at)) continue;
      // WA-LID-1: the phone answers only for the chat as it names it now, by the private id once the contact has one:
      // asked by the number, such a chat never answers (nothing came back for the 8 chats asked on 13-nov).
      const lid = normalJid(await s.signalRepository?.lidMapping?.getLIDForPN?.(c.conversation)?.catch(() => undefined));
      const remoteJid = chats.get(c.oldest.id) ?? (lid.endsWith("@lid") ? lid : c.conversation);
      try {
        await fetchHistory(HISTORY_COUNT, { remoteJid, id: c.oldest.id, fromMe: c.oldest.fromMe }, at);
      } catch (err) {
        // Not marked: the next connection tries it again.
        log?.warn({ err: errorMessage(err, 200) }, "whatsapp earlier messages not asked");
        continue;
      }
      asked.add(c.conversation);
      n++;
      try {
        fs.writeFileSync(askedFile(), JSON.stringify([...asked]), { mode: 0o600 });
      } catch {}
      await new Promise((r) => setTimeout(r, gap));
    }
    if (n) log?.info({ asked: n, left: Math.max(0, due.length - n) }, "whatsapp earlier messages asked");
  }

  /** A message's file, downloaded whole before it is stored (an expired link is asked of the sender's phone again). */
  async function fileOf(
    m: WaMessage,
    media: WaMedia,
  ): Promise<
    { file: { name: string; mime: string; data: string }; failure?: undefined } | { file?: undefined; failure: string }
  > {
    const limit = media.mime.startsWith("image/") ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.channelBytes;
    const over = `${media.name} is over ${Math.round(limit / 1024 / 1024)} MB`;
    if (media.size > limit) return { failure: over };
    const s = sock;
    try {
      const bytes = await lib?.downloadMediaMessage(
        m,
        "buffer",
        {},
        s?.updateMediaMessage ? { logger: quiet(log), reuploadRequest: s.updateMediaMessage } : undefined,
      );
      if (!bytes?.length) return { failure: "WhatsApp sent no file" };
      if (bytes.length > limit) return { failure: over };
      return { file: { name: media.name, mime: media.mime, data: bytes.toString("base64") } };
    } catch (err) {
      log?.warn({ err: errorMessage(err, 200), kind: media.kind }, "whatsapp file not downloaded");
      return { failure: "WhatsApp did not hand over the file" };
    }
  }

  /**
   * The owner's phone sends these messages again (WhatsApp's request for a message a device could not read). Its key
   * names the chat as the message came, which may be the number or the private id: each is tried in turn while some
   * are missing. Nothing comes while the phone is offline.
   */
  async function resent(
    s: WaSocket,
    ask: NonNullable<WaSocket["requestPlaceholderResend"]>,
    conversation: string,
    wanted: Array<{ id: string; fromMe: boolean }>,
  ): Promise<Map<string, WaMessage>> {
    const lid = isPhone(conversation)
      ? normalJid(await s.signalRepository?.lidMapping?.getLIDForPN?.(conversation)?.catch(() => undefined))
      : "";
    const jidsOf = (id: string) => [
      ...new Set([chats.get(id), lid, conversation].filter((j): j is string => Boolean(j))),
    ];
    const got = new Map<string, WaMessage>();
    for (let round = 0; round < 3; round++) {
      const asking = wanted.flatMap((w) => {
        const remoteJid = jidsOf(w.id)[round];
        return !got.has(w.id) && remoteJid ? [{ ...w, remoteJid }] : [];
      });
      if (!asking.length) break;
      await new Promise<void>((resolve) => {
        let left = asking.length;
        const end = () => {
          clearTimeout(limit);
          for (const w of asking) resending.delete(w.id);
          resolve();
        };
        const limit = setTimeout(end, opts.resendWaitMs ?? RESEND_WAIT_MS);
        for (const w of asking) {
          resending.set(w.id, (m) => {
            got.set(w.id, m);
            resending.delete(w.id);
            if (--left === 0) end();
          });
          void ask({ remoteJid: w.remoteJid, id: w.id, fromMe: w.fromMe }).catch((err) =>
            log?.warn({ err: errorMessage(err, 200) }, "whatsapp message not asked again"),
          );
        }
      });
    }
    return got;
  }

  async function sendOne(jid: string, content: Record<string, unknown>): Promise<string | undefined> {
    if (!sock || !me) throw new SendError("retry", "WhatsApp is not connected");
    sendsLive++;
    try {
      const r = await sock.sendMessage(jid, content);
      const id = r?.key?.id ?? undefined;
      remember(id);
      return id;
    } catch (err) {
      throw new SendError("uncertain", errorMessage(err));
    } finally {
      sendsLive--;
      lastSend = Date.now();
    }
  }

  const fileContent = (f: OutFile): Record<string, unknown> =>
    f.kind === "sticker"
      ? { sticker: f.data, mimetype: f.mime }
      : f.kind === "file"
        ? { document: f.data, mimetype: f.mime, fileName: fileName(f) }
        : f.kind === "image"
          ? { image: f.data, mimetype: f.mime }
          : f.mime === "audio/ogg"
            ? { audio: f.data, mimetype: "audio/ogg; codecs=opus", ptt: true }
            : { audio: f.data, mimetype: f.mime };

  async function stop(): Promise<void> {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(historyTimer);
    const s = sock;
    sock = undefined;
    me = undefined;
    try {
      s?.end(undefined);
    } catch {}
    // Auth initialization and queued saves must finish before a caller removes the session folder.
    await connecting.catch(() => {});
    await saving.catch(() => {});
  }

  return {
    caps: { typing: true, buttons: false, reactions: true, stickers: true, ownAccount: Boolean(opts.selfOwner) },
    async start(adapterIO) {
      io = adapterIO;
      stopped = false;
      qrRounds = 0;
      try {
        lib = await (opts.lib ?? loadBaileys)();
      } catch (err) {
        throw new ChannelRefused(`WhatsApp support could not load: ${errorMessage(err, 200)}`);
      }
      await connect();
      return { waiting: true };
    },
    stop,
    async forget() {
      stopped = true;
      me = undefined;
      clearTimeout(retry);
      try {
        await sock?.logout();
      } catch {}
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async send(conversation, p: Presentation, files = []) {
      const options = p.buttons?.length ? p.buttons : undefined;
      // Answering a business's menu with one of its options: that button, pressed.
      const menu = menus.get(conversation);
      const picked = menu && !options && !files.length && !p.skip ? optionNamed(menu, p.text) : undefined;
      if (menu && picked) {
        const id = await sendOne(conversation, tapFor(menu, picked));
        menus.delete(conversation);
        return id ? { external_id: id } : {};
      }
      const body = [
        p.text.trim() ? toWhatsApp(p.text) : "",
        options ? options.map((b, i) => `*${i + 1}* — ${b.label}`).join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const texts = (body ? chunks(body, 4000) : []).map((t) => () => sendOne(conversation, { text: t }));
      const media = files.map((f) => () => sendOne(conversation, fileContent(f)));
      // A voice note goes before the words it says.
      const steps: Array<() => Promise<string | undefined>> = p.mediaFirst
        ? [...media, ...texts]
        : [...texts, ...media];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<string | undefined>)();
        } catch (err) {
          const e = err instanceof SendError ? err : new SendError("uncertain", errorMessage(err));
          throw new SendError(e.kind, e.message, undefined, i - (p.skip ?? 0));
        }
      }
      if (options) offered.set(conversation, options);
      return last ? { external_id: last } : {};
    },
    async avatar(jid) {
      if (!sock?.profilePictureUrl) return undefined;
      const url = await sock.profilePictureUrl(jid, "image").catch(() => undefined);
      if (!url) return undefined;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return undefined;
      return {
        mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
        data: Buffer.from(await res.arrayBuffer()),
      };
    },
    async typing(conversation) {
      await sock?.sendPresenceUpdate("composing", conversation);
    },
    async react(conversation, ref, emoji) {
      if (!sock || !me) throw new SendError("retry", "WhatsApp is not connected");
      const remoteJid = chats.get(ref) ?? conversation;
      const r = await sock.sendMessage(conversation, {
        react: { text: emoji, key: { remoteJid, id: ref, fromMe: false } },
      });
      if (r?.key?.id) ownSends.add(r.key.id);
    },
    async recover(conversation, wanted): Promise<Recovered> {
      const s = sock;
      const ask = s?.requestPlaceholderResend?.bind(s);
      if (!s || !ask || !me) throw new Error("WhatsApp is not connected");
      const got = await resent(s, ask, conversation, wanted);
      const found: Recovered["found"] = [];
      for (const [id, m] of got) {
        const content = unwrap(m.message);
        const media = content ? mediaOf(content) : undefined;
        if (!media) {
          found.push({ id, failure: "WhatsApp sent the message without its file" });
          continue;
        }
        const r = await fileOf(m, media);
        found.push(r.file ? { id, file: r.file } : { id, failure: r.failure });
      }
      return { found };
    },
    presence(ids) {
      const s = sock;
      if (s?.presenceSubscribe && me)
        for (const id of ids)
          if (!watching.has(id)) {
            watching.add(id);
            void s.presenceSubscribe(id).catch(() => watching.delete(id));
          }
      return Object.fromEntries(
        ids.flatMap((id) => {
          const p = seen.get(id);
          return p ? [[id, p]] : [];
        }),
      );
    },
  };
}
