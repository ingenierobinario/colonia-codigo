import type { ReactNode } from "react";
import { cx } from "../cx";

export interface ActivityPillProps {
  /** What is happening: "Sending to Chief…", "Roby is writing…". */
  label: ReactNode;
  /** Avatars of who is involved, before the pill (AgentAvatar elements). */
  from?: ReactNode;
  /** Avatar after the pill — the recipient of a handoff. */
  to?: ReactNode;
  /** Tint of the dots and text. */
  tone?: "neutral" | "brand" | "violet" | "danger" | "info";
  className?: string;
}

/** Live activity between agents: animated dots + label, optionally flanked by sender/recipient avatars. */
export function ActivityPill({ label, from, to, tone = "neutral", className }: ActivityPillProps) {
  return (
    <div className={cx("colonia-activity", `colonia-tone--${tone}`, className)} role="status">
      {from && <span className="colonia-activity__who">{from}</span>}
      <span className="colonia-activity__pill">
        <span className="colonia-activity__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="colonia-activity__label">{label}</span>
      </span>
      {to && <span className="colonia-activity__who">{to}</span>}
    </div>
  );
}
