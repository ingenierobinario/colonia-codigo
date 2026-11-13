// PESTANAS-CHAT-1 — the chats open in tabs, above the chat on screen. Shown from the second tab on.
import { IconButton, Icons, Spinner } from "@colonia/ui";
import { type DragEvent, useEffect, useRef } from "react";
import { isWorking, threadAgent } from "../data/identity.ts";
import { newChatId, useNewChat } from "../data/newChat.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { chatLabel } from "../inbox/InboxViews.tsx";
import { useChatAgents } from "../inbox/NewChatMenu.tsx";
import { ThreadAvatar } from "../inbox/ThreadAvatar.tsx";
import type { Tabs } from "./tabs.ts";
import { closeTab, inNewTab, moveTab, showTab } from "./tabsSync.ts";
import "./chattabs.css";

export function ChatTabs({ tabs }: { tabs: Tabs }) {
  const t = useT();
  const dragged = useRef<string | undefined>(undefined);
  const first = useChatAgents(undefined)[0];
  const drag = {
    start: (id: string) => {
      dragged.current = id;
    },
    drop: (onto: string) => {
      if (dragged.current) moveTab(dragged.current, onto);
      dragged.current = undefined;
    },
    over: () => dragged.current != null,
  };
  return (
    <div className="chattabs">
      <div className="chattabs__list" role="tablist" aria-label={t("chat.tabs")}>
        {tabs.ids.map((id) => (
          <ChatTab key={id} id={id} active={id === tabs.active} drag={drag} />
        ))}
      </div>
      {first && (
        <IconButton
          size="sm"
          label={t("chat.newTab")}
          icon={<Icons.Plus size={14} />}
          onClick={() => inNewTab(() => showTab(newChatId({ agent: first.id })))}
        />
      )}
    </div>
  );
}

type Drag = { start: (id: string) => void; drop: (onto: string) => void; over: () => boolean };

function ChatTab({ id, active, drag }: { id: string; active: boolean; drag: Drag }) {
  const t = useT();
  const stored = useData((s) => s.threads[id]);
  const fresh = useNewChat(id);
  const thread = stored ?? fresh;
  const agent = threadAgent(thread, useShownAgents());
  const ref = useRef<HTMLDivElement>(null);
  // The tab on screen is never left outside the bar's scroll.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const label = !thread
    ? t("thread.chat")
    : thread.kind === "home"
      ? (agent?.name ?? thread.title)
      : chatLabel(thread, agent, t("chat.new"));
  const unread = !active && (thread?.unread ?? 0) > 0;
  const onDragOver = (e: DragEvent) => {
    if (!drag.over()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the frame only takes the pointer gestures (drag, middle button); its two buttons do the rest
    <div
      ref={ref}
      className={active ? "chattabs__tab is-active" : "chattabs__tab"}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", label);
        drag.start(id);
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        drag.drop(id);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) closeTab(id);
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="chattabs__open"
        title={label}
        onClick={() => showTab(id)}
      >
        {thread && <ThreadAvatar thread={thread} agent={agent} size={16} slot={16} />}
        {thread && isWorking(thread.state) && <Spinner size={12} />}
        <span className="chattabs__title">{label}</span>
        {unread && <span className="chattabs__dot" role="img" aria-label={t("chat.unread")} />}
      </button>
      <button type="button" className="chattabs__close" aria-label={t("chat.closeTab")} onClick={() => closeTab(id)}>
        <Icons.X size={12} />
      </button>
    </div>
  );
}
