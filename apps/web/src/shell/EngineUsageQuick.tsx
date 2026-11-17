import type { Result } from "@colonia/protocol";
import { EngineIcon } from "@colonia/ui";
import { remainingOf } from "./engineUsageModel.ts";

type Report = Result<"engines.usage">;

/** The most constrained reported window; absent quotas never become a balance. */
export function quickWindows(report: Report | undefined) {
  return (report?.engines ?? [])
    .flatMap((engine) => {
      if (!engine.available || engine.status !== "ok") return [];
      const window = engine.windows.reduce<(typeof engine.windows)[number] | undefined>(
        (best, next) =>
          Number.isFinite(next.used_percent) && (!best || next.used_percent > best.used_percent) ? next : best,
        undefined,
      );
      return window ? [{ engine, window, remaining: remainingOf(window) }] : [];
    })
    .slice(0, 4);
}

export default function EngineUsageQuick({ report }: { report: Report | undefined }) {
  return (
    <span className="engine-usage-quick" aria-hidden="true">
      {quickWindows(report).map(({ engine, remaining }) => (
        <span className="engine-usage-quick__item" key={engine.id} data-testid="engine-usage-quick">
          <EngineIcon engine={engine.id} tile size={16} />
          <span>{remaining}%</span>
        </span>
      ))}
    </span>
  );
}
