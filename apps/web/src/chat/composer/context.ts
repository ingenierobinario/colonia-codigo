import type { Message, Run } from "@colonia/protocol";

/**
 * How full the chat is, from the newest finished run (runs newest first). Engines that do not report it (Claude
 * Code, Codex) leave no figure rather than an older, stale one.
 */
export function contextOf(runs: readonly Run[], since?: string): { used: number; window?: number } | undefined {
  const last = runs.find((r) => r.usage);
  // A chat cleared after that run starts again from nothing (LIMPIAR-CHAT-1).
  if (last && since && last.started_at < since)
    return last.usage?.window ? { used: 0, window: last.usage.window } : undefined;
  return last?.usage?.context ? { used: last.usage.context, window: last.usage.window } : undefined;
}

/** When the chat was last cleared: its newest "Conversation cleared" line. */
export function clearedAt(messages: readonly Message[]): string | undefined {
  return messages.findLast((m) => m.parts.some((p) => p.type === "notice" && p.code === "thread.cleared"))?.created_at;
}

/** Tokens this chat has spent, from the core's totals over all its runs; undefined when none reported any. */
export function spentOf(
  totals: { input: number; output: number; cached: number } | undefined,
): { input: number; output: number; cached: number } | undefined {
  return totals && totals.input + totals.output ? totals : undefined;
}

/** Changes when a loaded run of the chat starts or ends: the core's totals are asked again then, not per render. */
export function usageStamp(runs: readonly Run[]): string {
  const ended = runs.filter((r) => r.ended_at);
  const newest = ended.reduce((at, r) => ((r.ended_at ?? "") > at ? (r.ended_at ?? "") : at), "");
  return `${runs.length}:${ended.length}:${newest}`;
}

/** Token counts read the same in every language: "38k", "1.0M". */
export function tokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}
