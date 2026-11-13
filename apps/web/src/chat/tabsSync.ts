// PESTANAS-CHAT-1 — keeps the open chat tabs (this device's prefs) in step with the chat on screen.
// PESTANAS-CHAT-2 — every chat that comes on screen has a tab of its own, as files do in an editor: opening another
// chat adds a tab, and one that is open already is brought forward.
import type { MouseEvent } from "react";
import { prefs, setPrefs } from "../data/prefs.ts";
import { data } from "../data/state.ts";
import { go, nav, showsChat } from "../shell/nav.ts";
import { close, move, numbered, open, prune, renamed, step, type Tabs, tabsOf } from "./tabs.ts";

export function currentTabs(): Tabs {
  const p = prefs.get();
  return tabsOf(p.chatTabs, p.chatTab);
}

function save(next: Tabs, before: Tabs): void {
  if (next !== before) setPrefs({ chatTabs: next.ids, chatTab: next.active });
}

/** A chat's row: a click opens it in its tab (a new one, unless it has one already); so does the middle button. */
export function tabClicks(openIt: () => void) {
  return {
    onClick: () => openIt(),
    // The middle button would start the list's autoscroll instead.
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) openIt();
    },
  };
}

/** Brings a tab's chat on screen without leaving the chat list that is open. */
export function showTab(id: string): void {
  if (showsChat(nav.get())) nav.set({ threadId: id, listInFront: false });
  else go.thread(id);
}

/** Closing the tab on screen shows its neighbour; the last one leaves no chat open. */
export function closeTab(id: string): void {
  const before = currentTabs();
  const next = close(before, id);
  save(next, before);
  if (before.active !== id) return;
  if (next.active) showTab(next.active);
  else if (nav.get().threadId === id) nav.set({ threadId: undefined });
}

export function moveTab(id: string, onto: string): void {
  const before = currentTabs();
  save(move(before, id, onto), before);
}

/** A new chat the core just made keeps the tab it was opened in, on screen or not. */
export function madeTab(newId: string, id: string): void {
  const before = currentTabs();
  save(renamed(before, newId, id), before);
}

/** Ctrl/⌘ with Tab (Shift goes back), W or a number, while chats are on screen and there is a tab to act on. */
export function tabShortcut(e: KeyboardEvent): boolean {
  const tabs = currentTabs();
  if (!tabs.ids.length || !showsChat(nav.get()) || e.altKey) return false;
  if (e.key === "Tab") {
    const id = step(tabs, e.shiftKey ? -1 : 1);
    if (id) showTab(id);
    return true;
  }
  if (e.shiftKey) return false;
  if (e.key === "w" || e.key === "W") {
    closeTab(tabs.active);
    return true;
  }
  if (!/^[1-9]$/.test(e.key)) return false;
  const id = numbered(tabs, Number(e.key));
  if (id) showTab(id);
  return true;
}

/** Follows the chat on screen and drops the tabs of deleted chats, until the returned function is called. */
export function watchTabs(): () => void {
  // What was open when the panel closed stays: the chat it starts on joins the tabs.
  const start = nav.get().threadId;
  const stored = currentTabs();
  if (start) save(open(stored, start), stored);

  const stopNav = nav.subscribe(() => {
    const id = nav.get().threadId;
    if (!id) return;
    const before = currentTabs();
    save(open(before, id), before);
  });

  const stopData = data.subscribe(() => {
    const s = data.get();
    if (!s.ready || s.connection === "offline") return;
    const before = currentTabs();
    // Only a chat the core no longer has: one that merely failed to load keeps its tab.
    const next = prune(before, (id) => s.threadLoad[id] === "error" && !s.threads[id]);
    if (next === before) return;
    const shown = nav.get().threadId;
    save(next, before);
    if (shown && !next.ids.includes(shown) && next.active) showTab(next.active);
  });

  return () => {
    stopNav();
    stopData();
  };
}
