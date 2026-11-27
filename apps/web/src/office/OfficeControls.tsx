import type { Project, Workspace } from "@colonia/protocol";
import { Button, IconButton, Icons, Input, Select } from "@colonia/ui";
import { DEFAULT_PID } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";

export function OfficeHeading({ onCreate, manage = false }: { onCreate: () => void; manage?: boolean }) {
  const t = useT();
  return (
    <header className="virtual-office__heading">
      <div>
        <p className="virtual-office__eyebrow">
          <Icons.Building2 size={15} /> COLONIA / {t("nav.office")}
        </p>
        <h1>{t("office.title")}</h1>
        <p>{t("office.subtitle")}</p>
      </div>
      <Button variant="secondary" onClick={onCreate}>
        <Icons.Plus size={15} />
        {t(manage ? "office.manageWorkspaces" : "office.newWorkspace")}
      </Button>
    </header>
  );
}

export function WorkspaceTabs({
  workspaces,
  selected,
  online,
  onSelect,
  rootName,
  onRename,
}: {
  workspaces: Workspace[];
  selected: string;
  online: boolean;
  onSelect: (id: string) => void;
  rootName: string;
  onRename: () => void;
}) {
  const t = useT();
  return (
    <div className="office-workspaces">
      <nav className="office-businesses" aria-label={t("office.workspace")}>
        {[{ id: "", name: rootName || t("office.default") }, ...workspaces].map((workspace) => (
          <button
            type="button"
            key={workspace.id}
            aria-pressed={selected === workspace.id}
            className={selected === workspace.id ? "is-selected" : ""}
            onClick={() => onSelect(workspace.id)}
          >
            <Icons.Building2 size={19} />
            <span>{workspace.name}</span>
            {selected === workspace.id && <span className={`office-dot is-${online ? "working" : "offline"}`} />}
          </button>
        ))}
      </nav>
      <Button className="office-rename" variant="ghost" onClick={onRename}>
        <Icons.Pencil size={15} />
        {t("office.rename")}
      </Button>
    </div>
  );
}

export function OfficeToolbar({
  project,
  projects,
  base,
  query,
  list,
  onProject,
  onQuery,
  onList,
}: {
  project: string;
  projects: readonly Project[];
  base: string;
  query: string;
  list: boolean;
  onProject: (id: string) => void;
  onQuery: (query: string) => void;
  onList: (list: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="office-toolbar">
      <Select
        label={t("office.project")}
        value={project}
        onValueChange={(value) => onProject(value ?? "")}
        options={[
          { value: "", label: t("office.allProjects") },
          { value: DEFAULT_PID, label: base },
          ...projects.filter((p) => p.registered !== false).map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <Input
        aria-label={t("office.search")}
        placeholder={t("office.search")}
        value={query}
        onChange={(event) => onQuery(event.currentTarget.value)}
      />
      <div className="office-view-switch">
        <button type="button" aria-pressed={!list} onClick={() => onList(false)}>
          <Icons.LayoutGrid size={15} />
          {t("office.office")}
        </button>
        <button type="button" aria-pressed={list} onClick={() => onList(true)}>
          <Icons.List size={15} />
          {t("office.list")}
        </button>
      </div>
    </div>
  );
}

export function OfficeStatus({
  online,
  people,
  working,
  waiting,
  onOpen,
}: {
  online: boolean;
  people: number;
  working: number;
  waiting: number;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <div className="office-statusbar">
      <span>
        <span className={`office-dot is-${online ? "working" : "offline"}`} />
        {t(online ? "office.live" : "office.offline")}
      </span>
      <span>{t("office.people", { count: people })}</span>
      <span>
        {working} {t("office.working").toLocaleLowerCase()}
      </span>
      {waiting > 0 && (
        <span>
          {waiting} · {t("office.waiting")}
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={onOpen}>
        {t("office.settings")}
        <Icons.ExternalLink size={14} />
      </Button>
    </div>
  );
}

export function OfficeZoom({ value, onChange }: { value: number; onChange: (zoom: number) => void }) {
  const t = useT();
  return (
    <div className="office-zoom">
      <IconButton
        label={t("office.zoomOut")}
        icon={<Icons.Minus size={15} />}
        disabled={value <= 0.7}
        onClick={() => onChange(Math.max(0.7, value - 0.1))}
      />
      <button type="button" onClick={() => onChange(1)} aria-label={t("office.resetZoom")}>
        {Math.round(value * 100)}%
      </button>
      <IconButton
        label={t("office.zoomIn")}
        icon={<Icons.Plus size={15} />}
        disabled={value >= 1.4}
        onClick={() => onChange(Math.min(1.4, value + 0.1))}
      />
    </div>
  );
}
