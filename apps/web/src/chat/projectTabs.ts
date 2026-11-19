import type { Thread } from "@colonia/protocol";
import { inProject } from "../data/identity.ts";
import { parseNewChat } from "../data/newChat.ts";

export function projectTabs(ids: string[], threads: Record<string, Thread>, project: string | undefined) {
  if (!project) return ids;
  return ids.filter((id) => {
    const draft = parseNewChat(id);
    if (draft) return inProject({ project_id: draft.project }, project);
    let thread = threads[id];
    const visited = new Set<string>();
    while (thread && !thread.project_id && thread.parent_id && !visited.has(thread.id)) {
      visited.add(thread.id);
      thread = threads[thread.parent_id];
    }
    return !!thread && inProject(thread, project);
  });
}
