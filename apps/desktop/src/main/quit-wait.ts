// ERR-4: quitting waits for the core this app runs to close its store and stop its agents' programs, instead of
// leaving while it is still writing. Bounded: a core that does not stop never keeps the app from quitting.

/** A little over what a core gets to stop cleanly before it is killed (core-process.ts: CLEAN_STOP_MS). */
export const QUIT_WAIT_MS = 7000;

type QuitEvent = { preventDefault(): void };

/**
 * The will-quit handler: the first quit is held back while `stop` runs (at most `ms`), then `quit` asks again and
 * that one goes through. Returns whether this quit goes through.
 */
export function waitOnQuit(opts: {
  stop: () => Promise<unknown>;
  quit: () => void;
  ms?: number;
  /** What must run once, when the quit is first asked (before waiting). */
  first?: () => void;
  /** What must run once the core has stopped (or the wait ran out), right before quitting for good. */
  last?: () => void;
  after?: (ms: number, fn: () => void) => () => void;
}): (e: QuitEvent) => boolean {
  const after =
    opts.after ??
    ((ms, fn) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  let state: "idle" | "waiting" | "done" = "idle";
  return (e) => {
    if (state === "done") return true;
    e.preventDefault();
    if (state === "waiting") return false;
    state = "waiting";
    const finish = () => {
      if (state === "done") return;
      state = "done";
      cancel();
      try {
        opts.last?.();
      } finally {
        opts.quit();
      }
    };
    const cancel = after(opts.ms ?? QUIT_WAIT_MS, finish);
    try {
      opts.first?.();
    } catch {
      // Nothing said on the way out keeps the app open.
    }
    // A stop that fails is still a stop that ended: quit.
    Promise.resolve().then(opts.stop).then(finish, finish);
    return false;
  };
}
