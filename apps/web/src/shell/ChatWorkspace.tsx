import type { ReactNode } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { ChatTabs } from "../chat/ChatTabs.tsx";
import { InboxList } from "../inbox/InboxList.tsx";
import { SidePanel } from "../panel/SidePanel.tsx";
import { ListColumn } from "./ListColumn.tsx";
import type { Layout } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { usePrefs, setPrefs } from "../data/prefs.ts";
import { close, move, type Tabs, tabsOf } from "../chat/tabs.ts";

/** Chat list · chat · side panel. The Inbox, a project's Chats tab and an engine's sessions share it. */
export function ChatWorkspace({ layout, list = <InboxList /> }: { layout: Layout; list?: ReactNode }) {
  const panel = useNav((s) => s.panel);
  const listInFront = useNav((s) => s.listInFront);
  const threadId = useNav((s) => s.threadId);
  const prefs = usePrefs((s) => ({ chatTabs: s.chatTabs, chatTab: s.chatTab }));
  const tabs: Tabs = tabsOf(prefs.chatTabs, prefs.chatTab);

  const handleCloseTab = (id: string, next: Tabs) => {
    setPrefs({ chatTabs: next.ids, chatTab: next.active });
    if (next.active) {
      go.thread(next.active);
    }
  };

  const handleMoveTab = (id: string, onto: string) => {
    const next = move(tabs, id, onto);
    setPrefs({ chatTabs: next.ids });
  };

  if (layout.compact)
    return (
      <div className="workspace">
        {listInFront || !threadId ? list : panel != null ? <SidePanel /> : <ChatView wideHeader={false} compact />}
      </div>
    );

  return (
    <div className="workspace">
      {layout.listW > 0 && <ListColumn width={layout.listW}>{list}</ListColumn>}
      <div className="chatcol">
        {tabs.ids.length > 1 && <ChatTabs tabs={tabs} onClose={handleCloseTab} onMoveTab={handleMoveTab} />}
        <ChatView wideHeader={layout.wideHeader} />
      </div>
      {panel != null && <SidePanel />}
    </div>
  );
}
