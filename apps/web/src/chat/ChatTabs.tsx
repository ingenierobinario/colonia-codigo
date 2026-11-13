// PESTANAS-CHAT-1 — the tab bar shown above the chat transcript, with drag reorder and keyboard shortcuts.
import { Icons } from "@colonia/ui";
import { useRef } from "react";
import type { Thread } from "@colonia/protocol";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { setPrefs } from "../data/prefs.ts";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { close, type Tabs } from "./tabs.ts";
import "./chattabs.css";

export type ChatTabsProps = {
  tabs: Tabs;
  onClose: (id: string, tabs: Tabs) => void;
  onMoveTab?: (id: string, onto: string) => void;
};

export function ChatTabs({ tabs, onClose, onMoveTab }: ChatTabsProps) {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const barRef = useRef<HTMLDivElement>(null);

  // On tab click: switch to that thread.
  const onSelectTab = (id: string) => {
    go.thread(id);
  };

  // On close button or middle click: close the tab.
  const onClickClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = close(tabs, id);
    onClose(id, next);
    if (next.active && next.active !== threadId) {
      go.thread(next.active);
    }
  };

  // Drag reorder.
  let dragId: string | undefined;
  const onDragStart = (e: React.DragEvent, id: string) => {
    dragId = id;
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: React.DragEvent, id: string) => {
    if (!dragId || dragId === id || !onMoveTab) return;
    e.preventDefault();
    onMoveTab(dragId, id);
    dragId = undefined;
  };

  if (!tabs.ids.length) return null;

  return (
    <div className="chattabs" ref={barRef} role="tablist">
      {tabs.ids.map((id) => {
        const thread = threads[id];
        const agent = agents[thread?.agent_ids[0] ?? ""];
        const isActive = id === tabs.active;
        return (
          <div
            key={id}
            className={`chattabs__tab ${isActive ? "is-active" : ""}`}
            role="tab"
            aria-selected={isActive}
            aria-label={thread?.title ?? id}
            onClick={() => onSelectTab(id)}
            onDragStart={(e) => onDragStart(e, id)}
            onDragOver={(e) => onDragOver(e, id)}
            onDrop={(e) => onDrop(e, id)}
            draggable
          >
            <div className="chattabs__content">
              {thread && (
                <>
                  <ThreadAvatar thread={thread} agent={agent} size={20} slot={24} />
                  <span className="chattabs__title">{thread.title}</span>
                  {thread.unread > 0 && <span className="chattabs__dot" aria-label={t("chat.unread")} />}
                </>
              )}
            </div>
            <button
              className="chattabs__close"
              onClick={(e) => onClickClose(e, id)}
              onAuxClick={(e) => e.button === 1 && onClickClose(e as any, id)}
              type="button"
              aria-label={t("chat.closeTab")}
            >
              <Icons.X size={14} />
            </button>
          </div>
        );
      })}
      <button className="chattabs__new" type="button" aria-label={t("chat.newTab")}>
        <Icons.Plus size={16} />
      </button>
    </div>
  );
}
