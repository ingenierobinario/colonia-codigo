// PESTANAS-CHAT-1 — the open chat tabs, as plain lists of chat ids. Nothing here knows the stores or the screen:
// each function takes the tabs and answers the next ones, so the rules (where a tab opens, which one takes over
// when the active closes) are the same wherever they are used.

/** More tabs than this and opening another closes the first one that is not on screen. */
export const MAX_TABS = 20;

export type Tabs = {
  /** Chat ids, left to right. */
  ids: string[];
  /** The tab on screen; "" when none of them is. */
  active: string;
};

/** What a stored value may be trusted for: unique ids, no more than the limit. */
export function tabsOf(rawIds: unknown, rawActive: unknown): Tabs {
  const ids = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, MAX_TABS)
    : [];
  return { ids, active: typeof rawActive === "string" ? rawActive : "" };
}

/**
 * PESTANAS-CHAT-2 — the chat that came on screen has a tab: its own when it had one, else a new one right after the
 * active tab. With no room left, the first tab that is not on screen makes way.
 */
export function open(tabs: Tabs, id: string): Tabs {
  if (tabs.ids.includes(id)) return tabs.active === id ? tabs : { ids: tabs.ids, active: id };
  let ids = tabs.ids;
  if (ids.length >= MAX_TABS) {
    const oldest = ids.findIndex((other) => other !== tabs.active);
    ids = ids.toSpliced(oldest < 0 ? 0 : oldest, 1);
  }
  const at = ids.indexOf(tabs.active);
  return { ids: ids.toSpliced(at < 0 ? ids.length : at + 1, 0, id), active: id };
}

/** Without that tab. Closing the active one hands over to the tab on its right, or on its left at the end. */
export function close(tabs: Tabs, id: string): Tabs {
  const at = tabs.ids.indexOf(id);
  if (at < 0) return tabs;
  const ids = tabs.ids.toSpliced(at, 1);
  if (tabs.active !== id) return { ids, active: tabs.active };
  return { ids, active: ids[at] ?? ids[at - 1] ?? "" };
}

/** A chat that got another id (a new chat, once it is made) keeps its tab. */
export function renamed(tabs: Tabs, from: string, to: string): Tabs {
  const at = tabs.ids.indexOf(from);
  if (at < 0) return tabs;
  const active = tabs.active === from ? to : tabs.active;
  if (tabs.ids.includes(to)) return { ids: tabs.ids.toSpliced(at, 1), active };
  return { ids: tabs.ids.with(at, to), active };
}

/** Without the chats that no longer exist; the active tab hands over as when it is closed. */
export function prune(tabs: Tabs, gone: (id: string) => boolean): Tabs {
  let next = tabs;
  for (const id of tabs.ids) if (gone(id)) next = close(next, id);
  return next;
}

/** The tab dragged onto another takes its place. */
export function move(tabs: Tabs, id: string, onto: string): Tabs {
  const from = tabs.ids.indexOf(id);
  const to = tabs.ids.indexOf(onto);
  if (from < 0 || to < 0 || from === to) return tabs;
  return { ids: tabs.ids.toSpliced(from, 1).toSpliced(to, 0, id), active: tabs.active };
}

/** The tab `by` places away from the active one, going round at the ends. */
export function step(tabs: Tabs, by: 1 | -1): string | undefined {
  if (!tabs.ids.length) return undefined;
  const at = tabs.ids.indexOf(tabs.active);
  if (at < 0) return by > 0 ? tabs.ids[0] : tabs.ids.at(-1);
  return tabs.ids[(at + by + tabs.ids.length) % tabs.ids.length];
}

/** The tab a number key asks for: 1 to 8 by position, 9 the last one. */
export function numbered(tabs: Tabs, n: number): string | undefined {
  return n === 9 ? tabs.ids.at(-1) : tabs.ids[n - 1];
}
