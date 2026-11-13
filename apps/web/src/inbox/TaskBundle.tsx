import type { Thread } from "@colonia/protocol";
import { ContextMenu, IconButton, Icons, Menu, type MenuEntry, Spinner } from "@colonia/ui";
import { AgentFace } from "../common/AgentFace.tsx";
import { shortWhen } from "../common/format.ts";
import { taskStateActions } from "../common/taskStateActions.tsx";
import { isWorking } from "../data/identity.ts";
import { useShownAgents } from "../data/state.ts";
import { archiveTaskChats } from "../data/taskChats.ts";
import { useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { TaskStatus } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { FoldHead, useFold } from "./FoldHead.tsx";
import { SessionRow } from "./InboxViews.tsx";

const cx = (...c: Array<string | false>) => c.filter(Boolean).join(" ");

/**
 * Every chat the agents keep for one task, as one row of a list: the task, who works it and whether it runs, with each
 * agent's chat nested under it, open until folded. The row only folds and unfolds; a chat's "Open the task" opens it.
 */
export function TaskBundle({ taskId, threads, selected }: { taskId: string; threads: Thread[]; selected?: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[taskId]);
  const agents = useShownAgents();
  const columns = useTasks((s) => s.columns);
  const archived = threads.every((th) => th.archived);
  const items: MenuEntry[] = [
    { label: t("tasks.menu.open"), icon: <Icons.PanelRight />, onSelect: () => go.task(taskId) },
    ...(task ? taskStateActions(task, columns, t) : []),
    { type: "separator" },
    {
      label: t(archived ? "tasks.chats.unarchive" : "tasks.chats.archive"),
      icon: archived ? <Icons.ArchiveRestore /> : <Icons.Archive />,
      onSelect: () => void archiveTaskChats(taskId, !archived),
    },
  ];
  const [open, setOpen] = useFold(`task:${taskId}`, { holdsSelected: threads.some((th) => th.id === selected) });
  const running = threads.some((th) => isWorking(th.state));
  const waiting = threads.some((th) => th.state === "input-required");
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const who = [...new Set(threads.map((th) => th.agent_ids[0] ?? ""))].map((id) => agents[id]).filter(Boolean);
  const title = task?.title ?? threads[0]?.title ?? taskId;
  return (
    <div className="taskbundle">
      <ContextMenu items={items} render={<div className={cx("taskbundle__head", unread > 0 && "is-unread")} />}>
        <FoldHead
          open={open}
          onToggle={() => setOpen(!open)}
          className="taskbundle__task"
          label={open ? t("inbox.taskBundle.close") : t("inbox.taskBundle.open")}
          unread={unread > 0}
          lead={<Icons.ListChecks size={16} className="taskbundle__icon" />}
          title={
            <>
              {running && <Spinner size={12} />}
              {waiting && <Icons.Hand size={12} className="tree__waiting" />}
              <TaskStatus id={taskId}>
                <span className="taskbundle__title">{title}</span>
              </TaskStatus>
            </>
          }
          count={
            <>
              <span className="taskbundle__faces" aria-hidden>
                {who.slice(0, 3).map((a) => a && <AgentFace key={a.id} agent={a} size={14} />)}
              </span>
              {t("inbox.taskBundle.chats", { n: threads.length })}
            </>
          }
          side={
            <>
              {unread > 0 && <span className="tree__unread">{unread}</span>}
              <span className="tree__when">{shortWhen(threads[0]?.updated_at ?? "")}</span>
            </>
          }
        />
        <Menu
          items={items}
          trigger={<IconButton size="sm" label={t("tasks.chats.actions")} icon={<Icons.Ellipsis size={14} />} />}
        />
      </ContextMenu>
      {open && (
        <div className="tree__sessions">
          {threads.map((th) => (
            <ListedChat key={th.id} thread={th} selected={selected}>
              <SessionRow thread={th} agent={agents[th.agent_ids[0] ?? ""]} selected={th.id === selected} withAgent />
            </ListedChat>
          ))}
        </div>
      )}
    </div>
  );
}
