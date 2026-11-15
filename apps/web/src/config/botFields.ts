// CANALES-SENCILLOS-2: what each bot channel asks the owner for, kept to the least each platform allows. What can be
// worked out is (a server from the user's address, a channel from the bot's name, a code from a pasted message), and
// what almost nobody changes waits under "More options" with the usual value already in place.
import type { MessageKey } from "../i18n/index.ts";

export type BotKind =
  | "telegram"
  | "discord"
  | "slack"
  | "matrix"
  | "mattermost"
  | "signal"
  | "googlechat"
  | "sms"
  | "ntfy"
  | "nextcloud"
  | "irc"
  | "twitch"
  | "teams"
  | "line";

/**
 * One field of the secret; `plain` ones (a server's address, a number) are not hidden as they are typed, `multiline`
 * ones take a pasted file (a JSON key).
 */
export type TokenSpec = {
  label: MessageKey;
  placeholder: string;
  pattern: RegExp;
  plain?: boolean;
  multiline?: boolean;
  /** Shown under "More options": the setup works without touching it. */
  advanced?: boolean;
  /** What the field counts as when left empty, from the other fields as typed. */
  fallback?(typed: readonly string[]): string;
  /** The code inside whatever was pasted (the platform's whole message): the field keeps only that. */
  pick?: RegExp;
  /** How the value is written in the stored secret, when not as typed. */
  words?(value: string): string;
  /** A value the setup opens with, so there is nothing to make up. */
  initial?(): string;
};

/** An Azure app's or tenant's id. */
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const OPTIONAL_URL = /^(https?:\/\/\S+)?$/;

/** A long topic nobody can guess: whoever knows an ntfy topic can write on it. */
export function randomTopic(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return `colonia-${[...random(new Uint8Array(16))].map((n) => abc[n % abc.length]).join("")}`;
}

/** "bot@cloud.example.org" as the server and the user the adapter reads: "https://cloud.example.org bot". */
export function nextcloudWords(address: string): string {
  const at = address.lastIndexOf("@");
  return `https://${address.slice(at + 1).replace(/\/+$/, "")} ${address.slice(0, at)}`;
}

/** A network as people write it ("irc.libera.chat") with what the adapter needs: encrypted, on the usual port. */
export const ircWords = (server: string): string => (/^ircs?:\/\//i.test(server) ? server : `ircs://${server}`);

/** The link that adds a Discord bot to a server, from the bot's code alone (its first part is the app's number). */
export function discordInvite(code: string): string | undefined {
  const head = code.trim().split(".")[0] ?? "";
  let id = "";
  try {
    id = atob(head.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return undefined;
  }
  // Read and write messages and their history, with files.
  return /^\d{17,20}$/.test(id)
    ? `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=117760`
    : undefined;
}

/**
 * What each bot channel needs: the steps to make the bot, and its field(s). Slack takes two (the bot's and the app's,
 * for Socket Mode), stored together as one secret.
 */
export const BOTS: Record<BotKind, { name: string; steps: MessageKey[]; tokens: TokenSpec[] }> = {
  telegram: {
    name: "Telegram",
    steps: ["tg.step1", "tg.step2"],
    // What BotFather hands out: the bot's number, a colon and its secret, inside a longer message.
    tokens: [
      { label: "tg.token", placeholder: "123456789:AA…", pattern: /^\d+:[\w-]{20,}$/, pick: /\d{5,}:[\w-]{30,}/ },
    ],
  },
  discord: {
    name: "Discord",
    steps: ["dc.step1", "dc.step2", "dc.step3"],
    tokens: [
      {
        label: "tg.token",
        placeholder: "MTA…",
        pattern: /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/,
        pick: /[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}/,
      },
    ],
  },
  slack: {
    name: "Slack",
    steps: ["sl.step1", "sl.step2", "sl.step3"],
    tokens: [
      { label: "sl.botToken", placeholder: "xoxb-…", pattern: /^xoxb-[\w-]{10,}$/, pick: /xoxb-[\w-]{10,}/ },
      { label: "sl.appToken", placeholder: "xapp-…", pattern: /^xapp-[\w-]{10,}$/, pick: /xapp-[\w-]{10,}/ },
    ],
  },
  matrix: {
    name: "Matrix",
    steps: ["mx.step1", "mx.step2"],
    // The server is found from the user, as every Matrix app does.
    tokens: [
      { label: "mx.user", placeholder: "@colonia:example.org", pattern: /^@[^:\s]+:\S+$/, plain: true },
      { label: "mx.password", placeholder: "", pattern: /^\S+$/ },
      {
        label: "mx.server",
        placeholder: "https://matrix.example.org",
        pattern: OPTIONAL_URL,
        plain: true,
        advanced: true,
      },
    ],
  },
  mattermost: {
    name: "Mattermost",
    steps: ["mm.step1", "mm.step2", "mm.step3"],
    tokens: [
      { label: "mm.server", placeholder: "https://chat.example.org", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "tg.token", placeholder: "abc123…", pattern: /^[a-z0-9]{20,}$/ },
    ],
  },
  signal: {
    name: "Signal",
    steps: ["sg.step1", "sg.step2", "sg.step3"],
    tokens: [
      { label: "sg.number", placeholder: "+15550001111", pattern: /^\+\d{6,15}$/, plain: true },
      {
        label: "sg.daemon",
        placeholder: "http://127.0.0.1:8080",
        pattern: /^https?:\/\/\S+$/,
        plain: true,
        advanced: true,
        fallback: () => "http://127.0.0.1:8080",
      },
    ],
  },
  googlechat: {
    name: "Google Chat",
    steps: ["gc.step1", "gc.step2", "gc.step3", "gc.step4"],
    tokens: [
      {
        label: "gc.subscription",
        placeholder: "projects/acme/subscriptions/colonia-chat",
        pattern: /^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/,
        plain: true,
      },
      {
        label: "gc.key",
        placeholder: '{ "type": "service_account", … }',
        pattern: /^\{[\s\S]*"private_key"[\s\S]*\}$/,
        multiline: true,
      },
    ],
  },
  sms: {
    name: "SMS",
    steps: ["sms.step1", "sms.step2", "sms.step3"],
    tokens: [
      { label: "sms.sid", placeholder: "AC0123…", pattern: /^AC[0-9a-fA-F]{32}$/, plain: true },
      { label: "sms.token", placeholder: "abc123…", pattern: /^[A-Za-z0-9]{16,}$/ },
      { label: "sg.number", placeholder: "+15550001111", pattern: /^\+[1-9]\d{6,14}$/, plain: true },
    ],
  },
  ntfy: {
    name: "ntfy",
    steps: ["nt.step1", "nt.step2"],
    tokens: [
      {
        label: "nt.topic",
        placeholder: "colonia-7f3k9q2m8x",
        pattern: /^[-_A-Za-z0-9]{1,64}$/,
        plain: true,
        initial: randomTopic,
      },
      {
        label: "nt.server",
        placeholder: "https://ntfy.sh",
        pattern: /^https?:\/\/\S+$/,
        plain: true,
        advanced: true,
        fallback: () => "https://ntfy.sh",
      },
      { label: "nt.token", placeholder: "tk_…", pattern: /^(tk_\S+)?$/, advanced: true },
    ],
  },
  nextcloud: {
    name: "Nextcloud Talk",
    steps: ["nc.step1", "nc.step2", "nc.step3"],
    tokens: [
      {
        label: "nc.address",
        placeholder: "colonia-bot@cloud.example.org",
        pattern: /^[^@\s]+@[^@\s/]+\.[^@\s]+$/,
        plain: true,
        words: nextcloudWords,
      },
      { label: "nc.password", placeholder: "xxxxx-xxxxx-…", pattern: /^\S{8,}$/ },
    ],
  },
  irc: {
    name: "IRC",
    steps: ["irc.step1", "irc.step2", "irc.step3"],
    tokens: [
      {
        label: "mm.server",
        placeholder: "irc.libera.chat",
        pattern: /^(ircs?:\/\/)?[\w.-]+\.[\w-]+(:\d{2,5})?$/i,
        plain: true,
        words: ircWords,
      },
      {
        label: "irc.nick",
        placeholder: "acme-bot",
        pattern: /^[A-Za-z[\]\\`_^{|}][\w[\]\\`^{|}-]{0,29}$/,
        plain: true,
      },
      { label: "irc.password", placeholder: "", pattern: /^\S*$/, advanced: true },
    ],
  },
  twitch: {
    name: "Twitch",
    steps: ["tw.step1", "tw.step2", "tw.step3"],
    tokens: [
      { label: "tw.login", placeholder: "acme_bot", pattern: /^\w{3,25}$/, plain: true },
      { label: "tw.token", placeholder: "oauth:…", pattern: /^(oauth:)?\w{20,}$/ },
      {
        label: "tw.channel",
        placeholder: "#acme",
        pattern: /^#?\w{3,25}$/,
        plain: true,
        advanced: true,
        // The bot's own chat, unless the owner names another.
        fallback: ([login]) => (login ? `#${login}` : ""),
      },
    ],
  },
  teams: {
    name: "Microsoft Teams",
    steps: ["tm.step1", "tm.step2", "tm.step3", "tm.step4", "tm.step5"],
    tokens: [
      { label: "tm.appId", placeholder: "00000000-0000-0000-0000-000000000000", pattern: GUID, plain: true },
      { label: "tm.secret", placeholder: "abc8Q~…", pattern: /^\S{8,}$/ },
      { label: "tm.tenant", placeholder: "00000000-0000-0000-0000-000000000000", pattern: GUID, plain: true },
    ],
  },
  line: {
    name: "LINE",
    steps: ["ln.step1", "ln.step2", "ln.step3", "ln.step4"],
    tokens: [
      { label: "ln.secret", placeholder: "0123456789abcdef…", pattern: /^[0-9a-fA-F]{32}$/ },
      { label: "ln.token", placeholder: "eyJhbGciOi…", pattern: /^[A-Za-z0-9+/=._-]{40,}$/ },
    ],
  },
};

/** What a field keeps of what was typed or pasted: the code alone when it came inside a longer text. */
export function pasted(spec: TokenSpec, raw: string): string {
  return spec.pick?.exec(raw)?.[0] ?? raw;
}

/** The fields as the one secret the core stores, once every one holds something valid (an empty optional adds nothing). */
export function botSecret(specs: readonly TokenSpec[], values: readonly string[]): { ok: boolean; joined: string } {
  const typed = specs.map((_, i) => (values[i] ?? "").trim());
  const filled = specs.map((s, i) => typed[i] || s.fallback?.(typed) || "");
  return {
    ok: specs.every((s, i) => s.pattern.test(filled[i] ?? "")),
    joined: specs
      .map((s, i) => (filled[i] && s.words ? s.words(filled[i]) : (filled[i] ?? "")))
      .filter(Boolean)
      .join(" "),
  };
}
