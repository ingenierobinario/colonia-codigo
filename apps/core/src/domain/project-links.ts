// Projects that know other projects (DECISIONS.md#d-191). A project's agents may read what the projects it knows
// hold: instructions, notes, skills, memory and files. One direction, one step (what B knows is not A's), read only.
// A Flow adds its own list for the chats it starts. `parent` only says where a project sits in the sidebar.
import type { ProjectRecord } from "./projects.ts";
import type { Store } from "./store.ts";

/** How many projects one project, or one Flow, may know. */
export const MAX_KNOWN = 16;

/** Whether going from `first` along `next` reaches `target`: the link `target → first` would close a loop. */
export function reaches(first: string, target: string, next: (id: string) => readonly string[]): boolean {
  const seen = new Set<string>();
  const todo = [first];
  while (todo.length) {
    const id = todo.pop() as string;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...next(id));
  }
  return false;
}

/** A project another may be linked to: registered by the owner and still in the list. Throws why not. */
function linkable(store: Store, id: string, own: string | undefined): ProjectRecord {
  const p = store.projects.get(id);
  if (!p || p.registered === false) throw new Error(`no project ${id}`);
  if (id === own) throw new Error(`${p.name} cannot be linked to itself`);
  return p;
}

/**
 * The projects a project (or a Flow of it) is to know, checked: each one registered, never itself, none twice, at
 * most MAX_KNOWN. With `loops`, none that already knows `own`, directly or through others. Throws the first problem.
 */
export function checkKnown(store: Store, own: string, ids: readonly string[], loops = true): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (out.includes(id)) continue;
    const p = linkable(store, id, own);
    if (loops && reaches(id, own, (x) => store.projects.get(x)?.knows ?? []))
      throw new Error(`${p.name} already knows this project: two projects cannot know each other in a loop`);
    out.push(id);
  }
  if (out.length > MAX_KNOWN) throw new Error(`a project can know up to ${MAX_KNOWN} others`);
  return out;
}

/** The project another is to sit under in the sidebar, checked: registered, never itself nor one under it. */
export function checkParent(store: Store, own: string, parent: string): string {
  const p = linkable(store, parent, own);
  const up = (x: string) => {
    const above = store.projects.get(x)?.parent;
    return above ? [above] : [];
  };
  if (reaches(parent, own, up)) throw new Error(`${p.name} is already under this project`);
  return parent;
}

/**
 * The projects a chat's agent may read besides its own: the ones its project knows, and the ones the Flow that started
 * the chat was given. Only those still registered; a link to one that is gone gives nothing and breaks nothing.
 */
export function knownProjects(
  store: Store,
  thread: { id?: string | undefined; project_id?: string | undefined },
): ProjectRecord[] {
  const own = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  const flow = thread.id ? store.threads.context(thread.id).flow_knows : undefined;
  const ids = [...new Set([...(own?.knows ?? []), ...(Array.isArray(flow) ? flow : [])])];
  const out: ProjectRecord[] = [];
  for (const id of ids) {
    const p = typeof id === "string" && id !== thread.project_id ? store.projects.get(id) : undefined;
    if (p && p.registered !== false) out.push(p);
  }
  return out;
}
