import type { ProjectTree } from "./groupThreads.ts";

/** Folds remembered at most: the oldest are forgotten (their group opens again). */
const KEPT = 300;

/**
 * ARBOL-PLEGAR-1: the key a group of the tree (a project, the base, a channel) folds under. It carries the list it is
 * shown in (a project's chats, or the Inbox) and the group's own id: a channel's is its account, never its kind, so two
 * WhatsApp accounts (Spain and Andorra) fold apart.
 */
export const treeFoldKey = (projectId: string | undefined, tree: Pick<ProjectTree, "key">): string =>
  `tree:${projectId ?? "inbox"}:${tree.key}`;

/** The folded groups after one is turned: open by default, so the list only holds the folded ones. */
export const toggleFolded = (folded: readonly string[], key: string): string[] =>
  folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key].slice(-KEPT);

/** Chats with something unread a group holds: what its head says while folded, so no notice is lost. */
export const treeUnread = (tree: Pick<ProjectTree, "agents">): number =>
  tree.agents.reduce((n, b) => n + b.threads.filter((th) => th.unread > 0).length, 0);
