// PROGRAMAS-1: the owner's desktop programs in the sidebar, opened with one click. Only in the desktop app: the list
// lives on this computer and a program is picked with the system's own dialog.

import { Button, ContextMenu, Dialog, IconButton, Icons, Input, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useState } from "react";
import type { DesktopProgram } from "../colonia-desktop.d.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { SidebarSection } from "../shell/SidebarSection.tsx";

export function ProgramsDock({ rail }: { rail: boolean }) {
  const t = useT();
  const desk = typeof window !== "undefined" ? window.coloniaDesktop : undefined;
  const [list, setList] = useState<DesktopProgram[]>([]);
  const [renaming, setRenaming] = useState<DesktopProgram>();
  useEffect(() => {
    void desk?.programs?.().then(setList);
  }, [desk]);
  if (!desk?.programs) return null;

  const launch = async (p: DesktopProgram) => {
    const why = await desk.launchProgram?.(p.id);
    if (why === "missing") notify(t("program.missing"), "error");
    else if (why) notify(t("program.failed"), "error");
  };

  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("program.title")}
        action={
          <IconButton
            size="sm"
            className="sidebar__add"
            label={t("program.add")}
            icon={<Icons.Plus size={14} />}
            onClick={() => void desk.addProgram?.().then(setList)}
          />
        }
      />
      {list.map((p) => (
        <ContextMenu
          key={p.id}
          items={[
            { label: t("program.rename"), icon: <Icons.Pencil size={14} />, onSelect: () => setRenaming(p) },
            {
              label: t("program.remove"),
              icon: <Icons.Trash2 size={14} />,
              danger: true,
              onSelect: () => void desk.removeProgram?.(p.id).then(setList),
            },
          ]}
        >
          <NavItem
            collapsed={rail}
            icon={
              <ProjectTile
                tone="info"
                icon={p.icon ? <img className="webapp__favicon" src={p.icon} alt="" /> : <Icons.Monitor />}
              />
            }
            label={p.name}
            onClick={() => void launch(p)}
          />
        </ContextMenu>
      ))}
      {renaming && (
        <RenameDialog
          program={renaming}
          onClose={() => setRenaming(undefined)}
          onSave={async (name) => {
            const next = await desk.renameProgram?.(renaming.id, name);
            if (next) setList(next);
            setRenaming(undefined);
          }}
        />
      )}
    </>
  );
}

function RenameDialog({
  program,
  onClose,
  onSave,
}: {
  program: DesktopProgram;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(program.name);
  const ok = name.trim().length > 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("program.rename")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ok} onClick={() => void onSave(name)}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t("program.name")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) void onSave(name);
        }}
      />
    </Dialog>
  );
}
