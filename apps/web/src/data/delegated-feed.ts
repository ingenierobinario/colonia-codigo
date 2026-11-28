import type { CoreEvent, Result } from "@colonia/protocol";

export type DelegatedInput = Result<"runs.delegated_pending">["inputs"][number];
export type DelegatedState = { inputs: DelegatedInput[]; failed: boolean };
type Delay = (run: () => void, ms: number) => () => void;
const delay: Delay = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** Coalesce live changes and discard reads overtaken by an answer, reconnect or closed conversation. */
export function delegatedFeed(
  read: () => Promise<DelegatedInput[]>,
  publish: (state: DelegatedState) => void,
  timers: { delay: Delay; now: () => number } = { delay, now: Date.now },
) {
  let closed = false;
  let busy = false;
  let revision = 0;
  let dirty = false;
  let cancel: (() => void) | undefined;
  let expiry: (() => void) | undefined;
  const load = async () => {
    cancel = undefined;
    if (closed || busy) return;
    busy = true;
    dirty = false;
    expiry?.();
    expiry = undefined;
    const at = revision;
    try {
      const inputs = await read();
      if (closed || at !== revision) return;
      publish({ inputs, failed: false });
      const deadline = Math.min(...inputs.map((input) => Date.parse(input.expires_at)));
      if (Number.isFinite(deadline))
        expiry = timers.delay(refresh, Math.max(1000, Math.min(2 ** 31 - 1, deadline - timers.now() + 1)));
    } catch {
      if (!closed && at === revision) publish({ inputs: [], failed: true });
    } finally {
      busy = false;
      if (!closed && (at !== revision || dirty)) cancel = timers.delay(() => void load(), at !== revision ? 0 : 100);
    }
  };
  function refresh() {
    if (closed) return;
    revision++;
    expiry?.();
    if (!busy && !cancel) cancel = timers.delay(() => void load(), 100);
  }
  return {
    refresh,
    changed() {
      if (closed) return;
      dirty = true;
      if (!busy && !cancel) cancel = timers.delay(() => void load(), 100);
    },
    close() {
      closed = true;
      cancel?.();
      expiry?.();
    },
  };
}

export function changesDelegatedInputs(event: CoreEvent): boolean {
  switch (event.type) {
    case "message.part":
      return event.part.type === "input";
    case "message.created":
    case "message.updated":
      return event.message.parts.some((part) => part.type === "input");
    case "thread.updated":
    case "thread.deleted":
    case "message.deleted":
    case "run.updated":
      return true;
    case "sync.updated":
      return event.data;
    default:
      return false;
  }
}
