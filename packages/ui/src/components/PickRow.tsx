import type { ReactNode } from "react";
import { cx } from "../cx";

export interface PickRowProps {
  title: ReactNode;
  /** Second line, clamped to one line. */
  description?: ReactNode;
  /** Before the title: an icon, a tile or an avatar. */
  leading?: ReactNode;
  /** After the title: chips, counters, a time. */
  trailing?: ReactNode;
  /** A small status dot at the end: on (brand), idle (brand ring: ready, not running), off (subtle), error, warning. */
  dot?: "on" | "idle" | "off" | "error" | "warning";
  /** Monospace title (ids: skills, servers, variables). */
  mono?: boolean;
  selected?: boolean;
  /** Faded: turned off, inherited and overridden, muted. */
  muted?: boolean;
  onClick?: () => void;
  className?: string;
}

/** One row of a MasterDetail list. */
export function PickRow({
  title,
  description,
  leading,
  trailing,
  dot,
  mono = false,
  selected = false,
  muted = false,
  onClick,
  className,
}: PickRowProps) {
  return (
    <button
      type="button"
      className={cx("colonia-pickrow", selected && "is-selected", muted && "is-muted", className)}
      aria-current={selected || undefined}
      onClick={onClick}
    >
      {leading && <span className="colonia-pickrow__lead">{leading}</span>}
      <span className="colonia-pickrow__main">
        <span className={cx("colonia-pickrow__title", mono && "is-mono")}>{title}</span>
        {description && <span className="colonia-pickrow__desc">{description}</span>}
      </span>
      {trailing && <span className="colonia-pickrow__trail">{trailing}</span>}
      {dot && <span className={`colonia-pickrow__dot is-${dot}`} />}
    </button>
  );
}
