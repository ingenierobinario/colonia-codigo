// DETENER-VIVO-1: what the live card of computer use shows, apart from React so it can be tested.
// After the emergency stop the card says so and then closes by itself; an action that was already on its way when the
// owner stopped must not open it again; and the owner can close it at any time.

export type LiveActivity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };

export type LiveState = {
  /** The agent's last action: while there is one, the card is open. */
  last: (LiveActivity & { at: number }) | undefined;
  /** The owner pulled the stop: the card says so until it closes. */
  stopped: boolean;
};

export type LiveEvent =
  | { type: "activity"; activity: LiveActivity; at: number }
  /** The desktop's word: true when the stop is pulled, false when its hold is over. */
  | { type: "stopped"; stopped: boolean }
  /** The owner's close button, or the card's own timers (idle, or the stop notice read). */
  | { type: "close" };

export const LIVE_CLOSED: LiveState = { last: undefined, stopped: false };

/** The stop notice stays this long when the desktop never says its hold is over. */
export const STOP_NOTICE_MS = 4_000;

export function liveReduce(s: LiveState, e: LiveEvent): LiveState {
  if (e.type === "close") return LIVE_CLOSED;
  if (e.type === "activity") {
    // Stopped: what arrives now is from an action the stop cut, not a new session.
    if (s.stopped) return s;
    return { last: { ...e.activity, at: e.at }, stopped: false };
  }
  if (e.stopped) return s.stopped ? s : { ...s, stopped: true };
  // The hold is over: computer use ended with the stop, so the card goes.
  return s.stopped ? LIVE_CLOSED : s;
}
