import type { ReactNode } from "react";
import { cx } from "../cx";

export interface MessageProps {
  /** agent = left, soft bubble; user = right, ink bubble (green in classic). */
  from?: "agent" | "user";
  /** Message body — text, StepList, EntityCard, VoiceNote… */
  children: ReactNode;
  /** Optional avatar at the left of agent messages (classic shows it; minimal usually omits it). */
  avatar?: ReactNode;
  /** Line under the bubble — MessageMeta, a timestamp. */
  meta?: ReactNode;
  /**
   * Controls for this one message (copy, fork, read aloud), shown on hover or keyboard focus: at the end of the meta
   * line when there is one, else in a row that opens under the bubble and moves the next message down.
   */
  actions?: ReactNode;
  /** Reaction emoji pinned to the bubble's bottom corner. */
  reactions?: ReactNode;
  /** bubble = text; bare = no bubble, for media and cards that carry their own surface. */
  variant?: "bubble" | "bare";
  /** Consecutive message from the same side: tighter top spacing. */
  grouped?: boolean;
  className?: string;
}

/** One chat message. Stack several for a turn; the agent's tools go in an ActionGroup between them. */
export function Message({
  from = "agent",
  children,
  avatar,
  meta,
  actions,
  reactions,
  variant = "bubble",
  grouped = false,
  className,
}: MessageProps) {
  return (
    <div
      className={cx(
        "colonia-msg",
        `colonia-msg--${from}`,
        grouped && "is-grouped",
        actions != null && "has-actions",
        className,
      )}
    >
      {from === "agent" && avatar && <span className="colonia-msg__avatar">{avatar}</span>}
      <div className="colonia-msg__col">
        <div className={cx(variant === "bubble" ? "colonia-msg__bubble" : "colonia-msg__bare")}>
          {children}
          {reactions && <span className="colonia-msg__reactions">{reactions}</span>}
        </div>
        {meta ? (
          <div className="colonia-msg__meta">
            {meta}
            {actions != null && <div className="colonia-msg__actions">{actions}</div>}
          </div>
        ) : (
          actions != null && (
            <div className="colonia-msg__reveal">
              <div className="colonia-msg__actions">{actions}</div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
