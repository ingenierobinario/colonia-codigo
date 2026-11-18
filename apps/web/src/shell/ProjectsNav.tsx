import { IconButton, Icons, Popover } from "@colonia/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ProjectAvatar } from "../common/ProjectAvatar.tsx";
import { type ProjectEntry, projectEntries } from "../data/identity.ts";
import { rememberSidebar, setPrefs, usePrefs, useSidebarRows } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog, ProjectSettings, ShareProjectDialog, UnregisterProjectDialog } from "../lazy.ts";
import { go, useNav } from "./nav.ts";
import { projectNavMenu } from "./ProjectNavActions.tsx";
import { projectActivity } from "./projectActivity.ts";
import { projectTree, type TreeRow } from "./projectTree.ts";
import { SidebarNavRow, SidebarTooltipButton } from "./SidebarNavRow.tsx";
import { SidebarOverflow, SidebarRowsGrip, SidebarSection } from "./SidebarSection.tsx";

/**
 * The Projects section: foldable as a whole, and past the rows the owner dragged it to the rest goes into a "N more"
 * popover.
 * The base space remains first, followed by the owner’s last opened or manually ordered projects.
 * A project sits under the one its owner put it in at every width: with names, indented and with a fold button; on
 * the icon rail, marked as inside another, with a button that opens the same tree with names beside it.
 */
export function ProjectsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.projectsFolded);
  const saved = usePrefs((s) => s.projectOrder);
  const closed = usePrefs((s) => s.projectsClosed);
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projects = useData((s) => s.projects);
  const base = useData((s) => s.base);
  const threads = useData((s) => s.threads);
  const [moreOpen, setMoreOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<ProjectEntry>();
  const [removing, setRemoving] = useState<ProjectEntry>();
  const [sharing, setSharing] = useState<ProjectEntry>();
  // The rail has no section header to unfold with, so it always lists them.
  const hidden = folded && !rail;
  const routines = usePrefs((s) => s.inboxRoutines);
  const rows = useSidebarRows("projects");
  const entries = useMemo(() => projectEntries(projects, base), [projects, base]);
  const { lastActive, running, unread } = useMemo(
    () => projectActivity(entries, Object.values(threads), routines),
    [entries, threads, routines],
  );
  const { tree, shown, rest, ordered } = useMemo(() => {
    const rank = new Map(saved.map((id, index) => [id, index]));
    const ordered = [...entries].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        (lastActive.get(b.id) ?? "").localeCompare(lastActive.get(a.id) ?? ""),
    );
    // A project sits under the one its owner put it in; with none nested this is the list as it was.
    const tree = projectTree(ordered, closed, view === "project" ? projectId : undefined);
    // Folding a single leftover would save nothing.
    const cut = tree.length > rows + 1 ? rows : tree.length;
    return {
      tree,
      shown: tree.slice(0, cut),
      rest: tree.slice(cut),
      ordered: ordered.map((p) => p.id),
    };
  }, [entries, lastActive, saved, rows, closed, view, projectId]);
  // Read when a project opens, not when the list reorders after it. The page coming back on a project (a reload)
  // is not opening it.
  const inView = useRef<string[]>([]);
  inView.current = shown.map((r) => r.entry.id);
  const open = view === "project" ? projectId : undefined;
  const lastOpen = useRef(open);
  useEffect(() => {
    if (open === lastOpen.current) return;
    lastOpen.current = open;
    if (open) rememberSidebar("projectOrder", open, inView.current);
  }, [open]);

  const item = ({ entry: p, depth, children, open: unfolded }: TreeRow<ProjectEntry>, onPick?: () => void) => (
    <SidebarNavRow
      id={p.id}
      kind="project"
      depth={depth}
      branch={
        children
          ? {
              open: unfolded,
              label: t(unfolded ? "nav.projectFold" : "nav.projectUnfold", { name: p.name, n: children }),
              onToggle: () =>
                setPrefs({
                  projectsClosed: unfolded ? [...closed, p.id] : closed.filter((id) => id !== p.id),
                }),
            }
          : undefined
      }
      order={ordered}
      locked={p.isDefault}
      onMove={(id, index) => {
        if (id === ordered[0]) return;
        const ids = ordered.filter((current) => current !== id);
        ids.splice(Math.max(1, index), 0, id);
        setPrefs({ projectOrder: ids });
      }}
      items={projectNavMenu(
        p,
        t,
        () => setSettings(p),
        () => setRemoving(p),
        () => {
          setMoreOpen(false);
          setTreeOpen(false);
        },
        () => setSharing(p),
        unread.get(p.id),
      )}
      key={p.id}
      rail={rail && !onPick}
      icon={<ProjectAvatar id={p.id} name={p.name} />}
      label={p.name}
      description={p.isDefault ? t("nav.baseProject") : undefined}
      trailing={
        running.has(p.id) ? (
          <span className="sidebar__running" title={t("common.running")} />
        ) : (
          unread.has(p.id) && <span className="sidebar__unread" title={t("inbox.unread")} />
        )
      }
      active={view === "project" && projectId === p.id}
      onPick={() => {
        onPick?.();
        go.project(p.id);
      }}
    />
  );

  const add = (
    <IconButton
      size="sm"
      className="sidebar__add"
      label={t("nav.newProject")}
      icon={<Icons.Plus size={14} />}
      onClick={() => setAdding(true)}
    />
  );

  // The rail shows tiles only: with a project inside another, this opens the tree with its names and fold buttons.
  const nested = tree.some((r) => r.children > 0);
  const railTree = rail && nested && (
    <Popover
      side="right"
      align="start"
      width={280}
      open={treeOpen}
      onOpenChange={setTreeOpen}
      label={t("nav.projectTree")}
      trigger={
        <SidebarTooltipButton label={t("nav.projectTree")} className="sidebar__add sidebar__tree">
          <Icons.FolderTree size={14} />
        </SidebarTooltipButton>
      }
    >
      <div className="morelist__head">{t("nav.projects")}</div>
      <div className="morelist" data-testid="project-tree">
        {tree.map((r) => item(r, () => setTreeOpen(false)))}
      </div>
    </Popover>
  );

  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.projects")}
        action={
          railTree ? (
            <>
              {railTree}
              {add}
            </>
          ) : (
            add
          )
        }
        folded={folded}
        onToggle={() => {
          setMoreOpen(false);
          setPrefs({ projectsFolded: !folded });
        }}
      />
      {!hidden && shown.map((r) => item(r))}
      {!hidden && rest.length > 0 && (
        <SidebarOverflow
          rail={rail}
          title={t("nav.moreProjects", { n: rest.length })}
          label={t("nav.moreProjects", { n: rest.length })}
          count={rest.length}
          active={view === "project" && rest.some((r) => r.entry.id === projectId)}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          {rest.map((r) => item(r, () => setMoreOpen(false)))}
        </SidebarOverflow>
      )}
      {!hidden && !rail && (
        <SidebarRowsGrip section="projects" total={shown.length + rest.length} title={t("nav.projects")} />
      )}
      <Suspense fallback={null}>
        {adding && <NewProjectDialog onClose={() => setAdding(false)} />}
        {settings && (
          <ProjectSettings project={settings} open onOpenChange={(open) => !open && setSettings(undefined)} />
        )}
        {sharing && <ShareProjectDialog project={sharing} onClose={() => setSharing(undefined)} />}
        {removing && <UnregisterProjectDialog project={removing} onClose={() => setRemoving(undefined)} />}
      </Suspense>
    </>
  );
}
