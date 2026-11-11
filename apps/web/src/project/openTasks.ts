// Open tasks by where they stand: what a project's overview counts and names. Pure, so it is tested on its own.
import type { Task } from "@colonia/protocol";
import { TASK_GROUP_ORDER, type TaskGroupId, taskGroupOf } from "@colonia/protocol/task-groups";

export type OpenGroup = Exclude<TaskGroupId, "closed">;

/** The open tasks by group, in the list's order: what needs the owner first; in each, newest activity first. */
export function openByGroup(
  tasks: readonly Task[],
  running: ReadonlySet<string>,
): Array<{ id: OpenGroup; items: Task[] }> {
  const open = tasks.filter((x) => x.state === "open").sort((a, b) => b.activity_at.localeCompare(a.activity_at));
  return TASK_GROUP_ORDER.flatMap((id) => {
    if (id === "closed") return [];
    const items = open.filter((x) => taskGroupOf(x, running) === id);
    return items.length ? [{ id, items }] : [];
  });
}
