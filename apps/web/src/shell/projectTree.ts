// The Projects section as a tree (DECISIONS.md#d-191): a project sits under the one its owner put it in. With no
// project under another, the rows are the list as it was, in the same order.

export type TreeEntry = { id: string; parent?: string | undefined };

export type TreeRow<T extends TreeEntry> = {
  entry: T;
  /** 0 at the top; never past MAX_DEPTH, however deep the owner nested them. */
  depth: number;
  /** How many projects sit right under it. */
  children: number;
  open: boolean;
};

export const MAX_DEPTH = 3;

/**
 * The rows to show, each project followed by the ones under it, all in the order given. A closed project hides what
 * is under it unless the open project is in there. One whose parent is not listed (or that would loop) stays on top.
 */
export function projectTree<T extends TreeEntry>(
  ordered: readonly T[],
  closed: readonly string[],
  active?: string,
): TreeRow<T>[] {
  const byId = new Map(ordered.map((p) => [p.id, p]));
  const parentOf = (p: T): string | undefined => {
    if (!p.parent || p.parent === p.id || !byId.has(p.parent)) return undefined;
    // A loop the core would never save: whoever is in it stays on top instead of vanishing.
    const seen = new Set([p.id]);
    for (let at = byId.get(p.parent); at; at = at.parent ? byId.get(at.parent) : undefined) {
      if (seen.has(at.id)) return undefined;
      seen.add(at.id);
    }
    return p.parent;
  };
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const p of ordered) {
    const parent = parentOf(p);
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), p]);
    else roots.push(p);
  }
  // The open project's ancestors show it even when folded.
  const forced = new Set<string>();
  for (let at = active ? byId.get(active) : undefined; at; ) {
    const parent = parentOf(at);
    if (!parent) break;
    forced.add(parent);
    at = byId.get(parent);
  }
  const rows: TreeRow<T>[] = [];
  const walk = (p: T, depth: number) => {
    const under = kids.get(p.id) ?? [];
    const open = under.length > 0 && (!closed.includes(p.id) || forced.has(p.id));
    rows.push({ entry: p, depth: Math.min(depth, MAX_DEPTH), children: under.length, open });
    if (open) for (const child of under) walk(child, depth + 1);
  };
  for (const p of roots) walk(p, 0);
  return rows;
}

/** The projects under this one, at any depth: none of them can be the one it sits under. */
export function projectsUnder(projects: readonly TreeEntry[], id: string): Set<string> {
  const under = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects)
      if (p.parent && !under.has(p.id) && p.id !== id && (p.parent === id || under.has(p.parent))) {
        under.add(p.id);
        grew = true;
      }
  }
  return under;
}
