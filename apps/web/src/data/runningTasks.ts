// Which tasks are being worked right now, as the set of their threads: what puts a task "in progress" on sight.
import type { Run } from "@colonia/protocol";
import { useMemo } from "react";
import { useData } from "./state.ts";
import { useTasks } from "./tasks.ts";

/** A task is being worked while one of these runs: a delegation queued for a slot is work taken on too. */
const LIVE: ReadonlySet<Run["state"]> = new Set(["queued", "submitted", "working"]);

/** A task is being worked while a turn runs in one of its agents' chats (or, from before, in its own thread). */
export function useRunningTasks(): ReadonlySet<string> {
  const runs = useData((s) => s.runs);
  const threads = useData((s) => s.threads);
  const all = useTasks((s) => s.tasks);
  return useMemo(() => {
    const live = Object.values(runs).flatMap((r) => (LIVE.has(r.state) ? [r.thread_id] : []));
    const tasks = new Set(live.flatMap((id) => threads[id]?.task_id ?? []));
    return new Set([...live, ...Object.values(all).flatMap((x) => (tasks.has(x.id) ? [x.thread_id] : []))]);
  }, [runs, threads, all]);
}
