import type { ReactNode } from "react";
import { ChatTabs } from "../chat/ChatTabs.tsx";
import { ChatView } from "../chat/ChatView.tsx";
import { projectTabs } from "../chat/projectTabs.ts";
import { tabsOf } from "../chat/tabs.ts";
import { usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { InboxList } from "../inbox/InboxList.tsx";
import { SidePanel } from "../panel/SidePanel.tsx";
import { ListColumn } from "./ListColumn.tsx";
import type { Layout } from "./layout.ts";
import { useNav } from "./nav.ts";

/** Chat list · chat · side panel. The Inbox, a project's Chats tab and an engine's sessions share it. */
export function ChatWorkspace({ layout, list = <InboxList /> }: { layout: Layout; list?: ReactNode }) {
  const panel = useNav((s) => s.panel);
  const listInFront = useNav((s) => s.listInFront);
  const threadId = useNav((s) => s.threadId);
  // PESTANAS-CHAT-2 — the tab bar is always above the chat, with one tab too.
  const ids = usePrefs((s) => s.chatTabs);
  const active = usePrefs((s) => s.chatTab);
  const pid = useNav((s) => (s.view === "project" ? s.projectId : undefined));
  const threads = useData((s) => s.threads);
  const visible = projectTabs(ids, threads, pid);
  const tabs = tabsOf(visible, threadId ?? active);
  const bar = <ChatTabs tabs={tabs} />;

  if (layout.compact) {
    if (listInFront || !threadId) return <div className="workspace">{list}</div>;
    if (panel != null)
      return (
        <div className="workspace">
          <SidePanel />
        </div>
      );
    return (
      <div className="workspace">
        <div className="chatcol">
          {bar}
          <ChatView wideHeader={false} compact />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      {layout.listW > 0 && <ListColumn width={layout.listW}>{list}</ListColumn>}
      <div className="chatcol">
        {bar}
        <ChatView wideHeader={layout.wideHeader} />
      </div>
      {panel != null && <SidePanel />}
    </div>
  );
}
