import type { Agent, Job, Thread } from "@colonia/protocol";

export type OfficePresence = "working" | "waiting" | "queued" | "idle" | "offline";
export type OfficeActivity = {
  presence: OfficePresence;
  summary: string;
  threadId?: string;
  active: number;
};

const priority = { waiting: 0, working: 1, queued: 2, idle: 3, offline: 4 } as const;

function presence(state: Thread["state"]): OfficePresence {
  if (state === "input-required") return "waiting";
  if (state === "working" || state === "submitted") return "working";
  if (state === "queued") return "queued";
  return "idle";
}

/** One bounded projection per agent; jobs also cover conversations outside the inbox's recency window. */
export function officeActivity(
  agents: readonly Agent[],
  jobs: readonly Job[],
  threads: readonly Thread[],
  online: boolean,
): Map<string, OfficeActivity> {
  const result = new Map<string, OfficeActivity>();
  const seen = new Map<string, Set<string>>();
  for (const agent of agents) {
    result.set(agent.id, { presence: online ? "idle" : "offline", summary: "", active: 0 });
    seen.set(agent.id, new Set());
  }
  if (!online) return result;
  const add = (agent: string, threadId: string, state: Thread["state"], summary: string) => {
    const current = result.get(agent);
    const counted = seen.get(agent);
    if (!current || !counted) return;
    const next = presence(state);
    if (next === "idle") return;
    counted.add(threadId);
    current.active = counted.size;
    if (priority[next] >= priority[current.presence]) return;
    current.presence = next;
    current.threadId = threadId;
    current.summary = summary.replace(/\s+/g, " ").trim().slice(0, 160);
  };
  // Job activity is more specific than a conversation preview and takes precedence on equal states.
  for (const job of [...jobs].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    if (!job.ended_at && job.agent_id)
      add(job.agent_id, job.thread_id, job.state, job.activity || job.thread_title || job.title);
  }
  for (const thread of [...threads].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    for (const agent of thread.agent_ids) add(agent, thread.id, thread.state, thread.preview || thread.title);
  }
  return result;
}
