// PESTANAS-CHAT-1 — sync nav.threadId to prefs.chatTabs and chatTab, applying the tab rules (show/open/close/prune).
import { data } from "../data/state.ts";
import { prefs, setPrefs } from "../data/prefs.ts";
import { nav } from "../shell/nav.ts";
import { close, open, prune, show, type Tabs, tabsOf } from "./tabs.ts";

export type ScrollMemory = { top: number; atEnd: boolean };
const scrollByThread = new Map<string, ScrollMemory>();

export function rememberScroll(threadId: string, mem: ScrollMemory): void {
  scrollByThread.set(threadId, mem);
}

export function recallScroll(threadId: string): ScrollMemory | undefined {
  return scrollByThread.get(threadId);
}

/** Flag set by inNewTab() to open the next chat in a tab of its own, instead of replacing the active. */
let armNextNew = false;

export function inNewTab(fn: () => void): void {
  armNextNew = true;
  fn();
  // Microtask boundary: React capture → React bubble (where our handler runs). Clear the flag so click listeners
  // see it armed if they are the handler that just ran; it stays false for other captures/bubbles after this one.
  setTimeout(() => {
    armNextNew = false;
  }, 0);
}

export function armed(): boolean {
  return armNextNew;
}

/** Subscribe to nav.threadId: apply the tab rules (show, open, close, prune) and persist. */
export function watchTabsSync(): void {
  let prev = prefs.get();

  const dispose = nav.subscribe(() => {
    const threadId = nav.get().threadId;
    if (!threadId) return;

    const tabs: Tabs = tabsOf(prev.chatTabs, prev.chatTab);

    let next: Tabs;
    if (armNextNew) {
      next = open(tabs, threadId);
      armNextNew = false;
    } else {
      next = show(tabs, threadId);
    }

    // Prune chats that no longer exist: a new-chat tab if the agent is unknown, or any tab in threadLoad[id]="error".
    const ready = data.get().ready;
    next = prune(next, (id) => {
      // New-chat tabs: gone if data is ready and the agent is not found.
      if (id.startsWith("new:")) return ready && !data.get().threads[id];
      // Old chats: gone if they are explicitly loaded and not found (threadLoad[id]="error").
      return data.get().threadLoad[id] === "error";
    });

    setPrefs({ chatTabs: next.ids, chatTab: next.active });
    prev = { ...prefs.get() };
  });

  // Listen to thread deletion (from forgetThreads) and prune.
  const disposeData = data.subscribe(() => {
    const tabs: Tabs = tabsOf(prev.chatTabs, prev.chatTab);
    const next = prune(tabs, (id) => data.get().threadLoad[id] === "error");
    if (next.ids !== tabs.ids || next.active !== tabs.active) {
      setPrefs({ chatTabs: next.ids, chatTab: next.active });
      prev = { ...prefs.get() };
    }
  });

  return () => {
    dispose();
    disposeData();
  };
}
