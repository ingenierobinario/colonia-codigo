// What a channel's error means for the owner: the raw text a service answered, turned into what to do about it.
import type { MessageKey } from "../i18n/index.ts";

export type ChannelProblem = "badKey" | "offline" | "loggedOut" | "conflict" | "other";

const RULES: Array<[ChannelProblem, RegExp]> = [
  // WhatsApp: the phone unlinked this device.
  ["loggedOut", /logged[_ ]?out|device[_ ]?removed|unlinked|session (closed|expired|replaced)|sesi[oó]n cerrada/i],
  // Telegram: two programs reading the same bot.
  ["conflict", /\b409\b|conflict|terminated by other|already (running|in use)|another (instance|client)/i],
  [
    "badKey",
    /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[_ ]?(auth|token|key|credentials)|token[_ ](invalid|revoked|expired)|bad credentials|not[_ ]authed|account_inactive|authentication failed|login failed/i,
  ],
  [
    "offline",
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network|timed? ?out|socket hang up|getaddrinfo|\b50[234]\b/i,
  ],
];

/** The kind of problem behind a channel's error, or undefined when there is none. */
export function channelProblem(error: string | null | undefined): ChannelProblem | undefined {
  const text = error?.trim();
  if (!text) return undefined;
  return RULES.find(([, re]) => re.test(text))?.[0] ?? "other";
}

/** The message that says what to do about it. */
export const problemKey = (problem: ChannelProblem): MessageKey => `ch.problem.${problem}`;
