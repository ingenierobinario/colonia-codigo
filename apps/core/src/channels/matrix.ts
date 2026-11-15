// Matrix through the Client-Server API: a long-polled /sync brings the events, answers go out with PUT …/send. Any
// homeserver, an access token, no library. Only direct messages (a room of two) are read; an invite to one is joined.
// End-to-end encrypted rooms cannot be read without a crypto store: the adapter says so once, in plain text.
import { randomUUID } from "node:crypto";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, numberedOptions, sleep, splitText } from "./net.ts";
import {
  type AdapterFactory,
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  type OutFile,
  SendError,
} from "./types.ts";

const CALL_MS = 20_000;
const POLL_MS = 30_000;
const UPLOAD_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_CHARS = 8000;
/** Events older than this when the adapter starts are history, not new messages (the dedupe covers the overlap). */
const CATCH_UP_MS = 10 * 60_000;

type MatrixEvent = {
  type?: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: { msgtype?: string; body?: string; membership?: string; displayname?: string };
};
type JoinedRoom = {
  summary?: { "m.joined_member_count"?: number };
  timeline?: { events?: MatrixEvent[] };
  state?: { events?: MatrixEvent[] };
};
type Sync = {
  next_batch: string;
  rooms?: { join?: Record<string, JoinedRoom>; invite?: Record<string, unknown> };
};

class MatrixError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(`Matrix: ${code} ${message}`.trim());
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** A full Matrix user: "@ana:example.org" (the part after the colon is where their server is found). */
const USER = /^@[^:\s]+:(\S+)$/;

/**
 * The account, stored as one secret, in any order. CANALES-SENCILLOS-2: "@bot:example.org password" signs in like any
 * Matrix app does, the server found from the user ("https://…" too when it cannot be). The older form, a homeserver
 * and an access token, still works.
 */
export function matrixSecret(secret: string | undefined): {
  homeserver?: string;
  token?: string;
  user?: string;
  password?: string;
} {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const homeserver = words.find((w) => /^https?:\/\//.test(w))?.replace(/\/+$/, "");
  const user = words.find((w) => USER.test(w));
  const word = words.find((w) => !/^https?:\/\//.test(w) && w !== user);
  return {
    ...(homeserver ? { homeserver } : {}),
    ...(user ? { user, ...(word ? { password: word } : {}) } : word ? { token: word } : {}),
  };
}

/** Where a user's server answers: what its domain publishes (".well-known"), else the domain itself. */
export async function matrixHomeserver(user: string, get: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const domain = USER.exec(user)?.[1] ?? "";
  try {
    const res = await get(`https://${domain}/.well-known/matrix/client`, {
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(CALL_MS)]),
    });
    const j = (res.ok ? await res.json() : {}) as { "m.homeserver"?: { base_url?: string } };
    const base = j["m.homeserver"]?.base_url;
    if (typeof base === "string" && /^https:\/\/\S+$/.test(base)) return base.replace(/\/+$/, "");
  } catch {
    // Nothing published: most small servers answer on their own domain.
  }
  return `https://${domain}`;
}

export const matrixAdapter = ((_config, secret): ChannelAdapter => {
  const ac = new AbortController();
  const account = matrixSecret(secret);
  let { homeserver, token } = account;
  let me = "";
  let loop: Promise<void> | undefined;
  /** Members of each joined room, from the sync summaries: two means a direct message. */
  const members = new Map<string, number>();
  const names = new Map<string, string>();
  const warnedEncrypted = new Set<string>();
  const options = numberedOptions();

  async function api<T>(method: string, path: string, body?: unknown, timeoutMs = CALL_MS): Promise<T> {
    if (!homeserver || !token) throw new MatrixError(401, "M_MISSING_TOKEN", "");
    const res = await fetch(`${homeserver}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const j = (await res.json().catch(() => ({}))) as { errcode?: string; error?: string; retry_after_ms?: number };
    if (!res.ok) throw new MatrixError(res.status, j.errcode ?? `HTTP ${res.status}`, j.error ?? "", j.retry_after_ms);
    return j as T;
  }

  const room = (id: string) => encodeURIComponent(id);

  /** "Ana (@ana:example.org)", looked up once per person. */
  async function nameOf(userId: string): Promise<string> {
    const known = names.get(userId);
    if (known) return known;
    try {
      const p = await api<{ displayname?: string }>("GET", `/_matrix/client/v3/profile/${room(userId)}`);
      const shown = (p.displayname ?? "")
        .replace(/[\p{Cc}\p{Cf}]/gu, "")
        .trim()
        .slice(0, 60);
      const name = shown ? `${shown} (${userId})` : userId;
      names.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  async function handle(sync: Sync, io: AdapterIO, since: number): Promise<void> {
    // An invite is joined: who may talk to the agent is decided after, by pairing.
    for (const id of Object.keys(sync.rooms?.invite ?? {}))
      await api("POST", `/_matrix/client/v3/rooms/${room(id)}/join`, {}).catch(() => {});
    for (const [id, r] of Object.entries(sync.rooms?.join ?? {})) {
      const count = r.summary?.["m.joined_member_count"];
      if (count !== undefined) members.set(id, count);
      if ((members.get(id) ?? 2) > 2) continue;
      for (const ev of r.timeline?.events ?? []) {
        if (!ev.event_id || !ev.sender || ev.sender === me) continue;
        if ((ev.origin_server_ts ?? 0) < since) continue;
        if (ev.type === "m.room.encrypted") {
          if (!warnedEncrypted.has(id)) {
            warnedEncrypted.add(id);
            await sendText(
              id,
              "I cannot read encrypted messages yet. Start a new chat with me with encryption turned off.",
            ).catch(() => {});
          }
          continue;
        }
        if (ev.type !== "m.room.message" || ev.content?.msgtype !== "m.text") continue;
        const sender = { id: ev.sender, name: await nameOf(ev.sender) };
        const text = ev.content.body ?? "";
        const picked = options.pick(id, text);
        if (picked) io.action({ conversation: id, sender, data: picked });
        else io.receive({ external_id: ev.event_id, conversation: id, sender, text, private: true });
      }
    }
  }

  async function run(io: AdapterIO): Promise<void> {
    let backoff = 1000;
    let next: string | undefined;
    const since = Date.now() - CATCH_UP_MS;
    while (!ac.signal.aborted && !io.signal.aborted) {
      try {
        const q = new URLSearchParams({ timeout: String(POLL_MS) });
        if (next) q.set("since", next);
        else q.set("filter", JSON.stringify({ room: { timeline: { limit: 20 } } }));
        const sync = await api<Sync>("GET", `/_matrix/client/v3/sync?${q}`, undefined, POLL_MS + CALL_MS);
        await handle(sync, io, since);
        next = sync.next_batch;
        io.status("running");
        backoff = 1000;
        continue;
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        if (err instanceof MatrixError && (err.status === 401 || err.code === "M_UNKNOWN_TOKEN")) {
          io.status("error", "the homeserver refused the access token: copy it again");
          return;
        }
        io.status("error", `cannot reach the homeserver: ${errorMessage(err)}`.slice(0, 200));
      }
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function sendText(roomId: string, text: string): Promise<string> {
    const r = await api<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${room(roomId)}/send/m.room.message/${randomUUID()}`,
      { msgtype: "m.text", body: text },
    );
    return r.event_id;
  }

  async function sendFile(roomId: string, f: OutFile): Promise<string> {
    if (!homeserver || !token) throw new MatrixError(401, "M_MISSING_TOKEN", "");
    const name = fileName(f);
    const res = await fetch(`${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": f.mime },
      body: new Uint8Array(f.data),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    if (!res.ok) throw new MatrixError(res.status, `HTTP ${res.status}`, "upload failed");
    const { content_uri } = (await res.json()) as { content_uri: string };
    const msgtype = f.kind === "image" ? "m.image" : f.kind === "audio" ? "m.audio" : "m.file";
    const r = await api<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${room(roomId)}/send/m.room.message/${randomUUID()}`,
      { msgtype, body: name, url: content_uri, info: { mimetype: f.mime, size: f.data.length } },
    );
    return r.event_id;
  }

  /** Signs in with the user and the password; the same device every time, so restarts do not pile up sessions. */
  async function signIn(user: string, password: string): Promise<void> {
    homeserver ??= await matrixHomeserver(user, fetch, ac.signal);
    const res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        identifier: { type: "m.id.user", user },
        password,
        device_id: "COLONIA",
        initial_device_display_name: "Colonia",
      }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (res.status === 401 || res.status === 403)
      throw new ChannelRefused("the homeserver refused the user or the password: check them");
    if (!res.ok || !j.access_token) throw new MatrixError(res.status, `HTTP ${res.status}`, "sign-in failed");
    token = j.access_token;
  }

  return {
    caps: { typing: true, buttons: false },
    async start(io) {
      if (account.user && account.password) await signIn(account.user, account.password);
      if (!homeserver || !token)
        throw new ChannelRefused("Matrix needs the bot's user (@bot:example.org) and its password");
      const who = await api<{ user_id: string }>("GET", "/_matrix/client/v3/account/whoami").catch((err: unknown) => {
        throw err instanceof MatrixError && (err.status === 401 || err.code === "M_UNKNOWN_TOKEN")
          ? new ChannelRefused("the homeserver refused the access token: copy it again")
          : err;
      });
      me = who.user_id;
      loop = run(io);
      return { account: me, waiting: true };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      const steps: Array<() => Promise<string>> = [
        ...texts.map((t) => () => sendText(conversation, t)),
        ...files.map((f) => () => sendFile(conversation, f)),
      ];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<string>)();
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
    async typing(conversation) {
      await api("PUT", `/_matrix/client/v3/rooms/${room(conversation)}/typing/${room(me)}`, {
        typing: true,
        timeout: 10_000,
      }).catch(() => {});
    },
  };
}) satisfies AdapterFactory;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof MatrixError) {
    if (err.status === 429 || err.code === "M_LIMIT_EXCEEDED")
      return new SendError("retry", msg, err.retryAfterMs ?? 5000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
