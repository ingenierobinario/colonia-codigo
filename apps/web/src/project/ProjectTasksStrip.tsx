// A project's open tasks at a glance on its overview: one line of counts, a few titles and the way to the Tasks tab.
import { useEffect, useMemo } from "react";
import { inProject } from "../data/identity.ts";
import { useRunningTasks } from "../data/runningTasks.ts";
import { loadTasks, tasksLoaded, useTasks } from "../data/tasks.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { nav } from "../shell/nav.ts";
import { type OpenGroup, openByGroup } from "./openTasks.ts";

/** How many open tasks the strip names; the rest are one click away. */
const PEEK = 3;
const COUNT: Record<OpenGroup, { one: MessageKey; other: MessageKey }> = {
  proposed: { one: "overview.tasks.proposed.one", other: "overview.tasks.proposed.other" },
  blocked: { one: "overview.tasks.blocked.one", other: "overview.tasks.blocked.other" },
  doing: { one: "overview.tasks.doing.one", other: "overview.tasks.doing.other" },
  pending: { one: "overview.tasks.pending.one", other: "overview.tasks.pending.other" },
  review: { one: "overview.tasks.review.one", other: "overview.tasks.review.other" },
};

/** Nothing at all while the project has no open task: the overview stays as quiet as it was. */
export function ProjectTasksStrip({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useTasks((s) => s.tasks);
  const running = useRunningTasks();
  useEffect(() => {
    if (!tasksLoaded()) void loadTasks();
  }, []);
  const groups = useMemo(
    () =>
      openByGroup(
        Object.values(all).filter((x) => inProject(x, projectId)),
        running,
      ),
    [all, projectId, running],
  );
  if (!groups.length) return null;
  const rows = groups.flatMap((g) => g.items.map((task) => ({ task, group: g.id }))).slice(0, PEEK);
  const toTasks = (taskId?: string) => nav.set({ projectTab: "tasks", taskId });
  return (
    <section className="overview__block">
      <h2 className="overview__h">
        {t("overview.tasks")}
        <button type="button" className="overview__link" onClick={() => toTasks()}>
          {t("overview.tasks.seeAll")}
        </button>
      </h2>
      <p className="overview__taskcount">
        {groups
          .map((g) => t(g.items.length === 1 ? COUNT[g.id].one : COUNT[g.id].other, { n: g.items.length }))
          .join(" · ")}
      </p>
      {rows.map(({ task, group }) => (
        <button key={task.id} type="button" className="overview__row" onClick={() => toTasks(task.id)}>
          <span className="taskrow__glyph overview__taskglyph" />
          <span className="overview__rowname overview__taskname">{task.title}</span>
          <span className="overview__rowwhen overview__taskwhere">{t(`tasks.group.${group}`)}</span>
        </button>
      ))}
    </section>
  );
}
