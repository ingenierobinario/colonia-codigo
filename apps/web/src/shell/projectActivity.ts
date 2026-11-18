import type { Thread } from "@colonia/protocol";
import { DEFAULT_PID, inInbox, isListed, isWorking } from "../data/identity.ts";

export type ActivityThread = Pick<
  Thread,
  "id" | "project_id" | "kind" | "archived" | "parent_id" | "state" | "updated_at" | "unread"
>;

export function projectActivity(
  entries: readonly { id: string }[],
  threads: readonly ActivityThread[],
  routines: boolean,
) {
  const projects = new Map(entries.map((p) => [p.id, { latest: "", active: false }]));
  const unread = new Map<string, string[]>();
  for (const thread of threads) {
    const projectId = thread.project_id;
    const id = projectId || DEFAULT_PID;
    const project = projectId === DEFAULT_PID ? undefined : projects.get(id);
    if (project && isListed(thread)) {
      if (isWorking(thread.state)) project.active = true;
      if (thread.updated_at > project.latest) project.latest = thread.updated_at;
    }
    if (thread.unread === 0 || !inInbox(thread, routines)) continue;
    const key = project ? id : "";
    const list = unread.get(key);
    if (list) list.push(thread.id);
    else unread.set(key, [thread.id]);
  }
  const lastActive = new Map<string, string>();
  const running = new Set<string>();
  for (const [id, project] of projects) {
    if (project.latest) lastActive.set(id, project.latest);
    if (project.active) running.add(id);
  }
  return { running, unread, lastActive };
}
