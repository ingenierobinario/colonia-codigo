import type { Result } from "@colonia/protocol";
import type { T } from "../i18n/index.ts";

type Window = Result<"engines.usage">["engines"][number]["windows"][number];

export function windowLabel(window: Window, t: T): string {
  const minutes = window.window_minutes;
  if (minutes === 300) return t("engineUsage.fiveHours");
  if (minutes === 10080) return t("engineUsage.weekly");
  return minutes
    ? t("engineUsage.window", { minutes })
    : t(window.id === "primary" ? "engineUsage.primary" : "engineUsage.secondary");
}

/**
 * CUOTAS-IA-2: what is left of a window, 0–100, rounded as the text says it. The bar, its text and the top bar's
 * figure all show this same number: what is still available, never what was used.
 */
export function remainingOf(window: Pick<Window, "used_percent">): number {
  const used = Number.isFinite(window.used_percent) ? window.used_percent : 100;
  return Math.round(100 - Math.max(0, Math.min(100, used)));
}

/** A bar of what is left warns as it runs out. */
export function remainingTone(remaining: number): "danger" | "warning" | "brand" {
  return remaining <= 8 ? "danger" : remaining <= 20 ? "warning" : "brand";
}

type Engine = Result<"engines.usage">["engines"][number];
/** An engine with no quota anyone can read (an ACP CLI, OpenCode) has nothing to show in «Cuotas de IA». */
export const showsUsage = (engine: Engine) => engine.reason !== "unsupported";
