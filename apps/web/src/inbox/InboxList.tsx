import { Button, EmptyState, IconButton, Icons, Menu, SearchField, SegmentedControl, Skeleton } from "@colonia/ui";
import { Suspense, useMemo, useState } from "react";
import { markAllRead } from "../data/actions.ts";
import { useChannels } from "../data/channels.ts";
import { findProject, threadAgent } from "../data/identity.ts";
import { type InboxView, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ActivityView, TaskBundle } from "../lazy.ts";
import { go, useNav } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { FoldHead, useFold } from "./FoldHead.tsx";
import { archivedThreads, bundleTasks, flatChats, groupByAgent, groupByTime, unreadListed } from "./groupThreads.ts";
import { TreeView } from "./InboxViews.tsx";
import { NewChatMenu, startChat, useChatAgents } from "./NewChatMenu.tsx";
import { RoutineBundle } from "./RoutineBundle.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

/** Chat list: every chat grouped by project (Inbox), or one project's chats (project › Chats). */
export function InboxList() {
  const t = useT();
  const projectId = useNav((s) => (s.view === "project" ? s.projectId : undefined));
  const threadId = useNav((s) => s.threadId);
  const threads = useData((s) => s.threads);
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const offline = useData((s) => s.connection === "offline");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useFold("archived", { startOpen: false });
  const chatAgents = useChatAgents(projectId);

  const view = usePrefs((s) => s.inboxView);
  const routines = usePrefs((s) => s.inboxRoutines);
  const channels = useChannels((s) => s.channels);
  // BANDEJA-1: "By chat" is one list, newest first, as the docs say; the tree groups by project and by channel.
  const chats = useMemo(
    () => flatChats(threads, { projectId, query, routines }),
    [threads, projectId, query, routines],
  );
  const trees = useMemo(
    () =>
      view === "tree"
        ? groupByAgent(threads, projects, { projectId, query, routines }, new Map(channels.map((c) => [c.id, c.label])))
        : [],
    [view, threads, projects, projectId, query, routines, channels],
  );
  const activity = useMemo(
    () => (view === "activity" ? groupByTime(threads, { projectId, query, routines }) : []),
    [view, threads, projectId, query, routines],
  );
  const archived = useMemo(() => archivedThreads(threads, { projectId, query }), [threads, projectId, query]);
  // The chats the Inbox counts as unread, in this project when one is open.
  const unreadIds = useMemo(() => unreadListed(threads, { projectId, routines }), [threads, routines, projectId]);
  const title = projectId
    ? t("inbox.projectChats", { project: findProject(projects, projectId)?.name ?? t("project.fallback") })
    : t("nav.inbox");

  const newChat = () => {
    const first = chatAgents[0];
    if (first) startChat(first, projectId);
  };

  return (
    <section className="inbox" aria-label={title}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <h1 className="inbox__title">{title}</h1>
          <IconButton
            className="inbox__fold"
            label={t("inbox.collapse")}
            icon={<Icons.PanelLeftClose size={16} />}
            onClick={() => setPrefs({ listCollapsed: true })}
          />
          <IconButton
            label={t("inbox.markAllRead")}
            icon={<Icons.CheckCheck size={16} />}
            disabled={unreadIds.length === 0}
            onClick={() => void markAllRead(unreadIds)}
          />
          <Menu
            align="end"
            trigger={<IconButton label={t("inbox.filter")} icon={<Icons.Filter size={16} />} active={!routines} />}
            items={[
              { type: "label", label: t("inbox.filter.show") },
              {
                label: t("inbox.filter.routines"),
                icon: <Icons.Clock size={14} />,
                checked: routines,
                onSelect: () => setPrefs({ inboxRoutines: !routines }),
              },
            ]}
          />
          <NewChatMenu
            projectId={projectId}
            trigger={<IconButton label={t("chat.new")} icon={<Icons.SquarePen size={16} />} disabled={!ready} />}
          />
        </div>
        <SegmentedControl
          size="sm"
          className="inbox__views"
          label={t("inbox.view")}
          value={view}
          onValueChange={(v) => setPrefs({ inboxView: v as InboxView })}
          options={[
            { value: "tree", label: t("inbox.view.tree") },
            { value: "activity", label: t("inbox.view.activity") },
            { value: "chats", label: t("inbox.view.chats") },
          ]}
        />
        <SearchField
          size="sm"
          placeholder={t("inbox.search")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <div className="inbox__list" data-view={view}>
        {!ready && offline ? (
          <EmptyState icon={<Icons.WifiOff />} title={t("inbox.offline.title")}>
            {t("inbox.offline.body")}
          </EmptyState>
        ) : !ready ? (
          <InboxSkeleton />
        ) : chats.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon={<Icons.Inbox />}
            title={query ? t("inbox.noResults") : t("inbox.empty")}
            action={
              !query && (
                <Button size="sm" onClick={newChat}>
                  {t("chat.new")}
                </Button>
              )
            }
          >
            {query ? t("inbox.noMatch", { query }) : t("inbox.emptyBody")}
          </EmptyState>
        ) : view === "tree" ? (
          <TreeView trees={trees} selected={threadId} projectId={projectId} />
        ) : view === "activity" ? (
          <Suspense fallback={<InboxSkeleton />}>
            <ActivityView groups={activity} selected={threadId} />
          </Suspense>
        ) : (
          bundleTasks(chats).map((entry) =>
            entry.kind === "routine" ? (
              <RoutineBundle
                key={`routine:${entry.routineId}`}
                routineId={entry.routineId}
                threads={entry.threads}
                selected={threadId}
              />
            ) : entry.kind === "task" ? (
              <Suspense key={entry.taskId} fallback={null}>
                <TaskBundle taskId={entry.taskId} threads={entry.threads} selected={threadId} />
              </Suspense>
            ) : (
              <ListedChat key={entry.thread.id} thread={entry.thread} selected={threadId}>
                <ThreadRow
                  thread={entry.thread}
                  agent={threadAgent(entry.thread, agents)}
                  selected={entry.thread.id === threadId}
                  onOpen={() => go.thread(entry.thread.id)}
                />
              </ListedChat>
            ),
          )
        )}
        {ready && archived.length > 0 && (
          <div className="inbox__archived">
            <FoldHead
              open={showArchived}
              onToggle={() => setShowArchived(!showArchived)}
              label={t("inbox.archived")}
              lead={<Icons.Archive size={16} className="taskbundle__icon" />}
              title={<span className="taskbundle__title">{t("inbox.archived")}</span>}
              count={archived.length}
            />
            {showArchived &&
              archived.map((th) => (
                <ThreadRow
                  key={th.id}
                  thread={th}
                  agent={threadAgent(th, agents)}
                  selected={th.id === threadId}
                  onOpen={() => go.thread(th.id)}
                />
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InboxSkeleton() {
  return (
    <div className="inbox__skeleton" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="inbox__skelrow">
          <Skeleton shape="circle" width={36} />
          <div className="inbox__skeltext">
            <Skeleton width="60%" />
            <Skeleton width="85%" />
          </div>
        </div>
      ))}
    </div>
  );
}
