// ERR-3: an error nobody handled, anywhere in the core (a promise started from an event, a throw inside a timer), is
// written to the log and the core keeps serving. Without this Node ends the process: every agent, every channel and
// every running command went down with one stray rejection in one of them.
import { errorMessage } from "./errors.ts";
import type { Log } from "./log.ts";

type Emitter = Pick<NodeJS.Process, "on" | "off">;

/** Starts logging stray errors instead of dying of them. Returns how to stop. */
export function surviveStrayErrors(log: Pick<Log, "error">, proc: Emitter = process): () => void {
  const told = (kind: string) => (err: unknown) => {
    try {
      log.error(
        { err: errorMessage(err, 500), stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined },
        kind,
      );
    } catch {}
  };
  const rejection = told("unhandled rejection: the core keeps running");
  const exception = told("uncaught exception: the core keeps running");
  proc.on("unhandledRejection", rejection);
  proc.on("uncaughtException", exception);
  return () => {
    proc.off("unhandledRejection", rejection);
    proc.off("uncaughtException", exception);
  };
}
