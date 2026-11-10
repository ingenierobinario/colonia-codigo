// PROGRAMAS-1: the owner's desktop programs, listed under Aplicaciones › Externas and opened with one click. Only in the
// desktop app: the list lives on this computer and a program is picked with the system's own dialog.
import { Button, ContextMenu, Dialog, Icons, Input, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useState } from "react";
import type { DesktopProgram } from "../colonia-desktop.d.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

const store = createStore<{ list: DesktopProgram[] }>({ list: [] });
const desk = () => (typeof window !== "undefined" ? window.coloniaDesktop : undefined);
const keep = (list: DesktopProgram[] | undefined) => {
  if (list) store.set({ list });
};

/** Whether this window can pin programs (the desktop app). */
export const canPinPrograms = () => Boolean(desk()?.programs);
/** The system's file dialog; the chosen programs join the list. */
export const addProgram = () => void desk()?.addProgram?.().then(keep);

export function ProgramItems({ rail }: { rail: boolean }) {
  const t = useT();
  const list = useSlice(store, (s) => s.list);
  const [renaming, setRenaming] = useState<DesktopProgram>();
  useEffect(() => {
    void desk()?.programs?.().then(keep);
  }, []);
  if (!canPinPrograms()) return null;

  const launch = async (p: DesktopProgram) => {
    const why = await desk()?.launchProgram?.(p.id);
    if (why === "missing") notify(t("program.missing"), "error");
    else if (why) notify(t("program.failed"), "error");
  };

  return (
    <>
      {list.map((p) => (
        <ContextMenu
          key={p.id}
          items={[
            { label: t("program.rename"), icon: <Icons.Pencil size={14} />, onSelect: () => setRenaming(p) },
            {
              label: t("program.remove"),
              icon: <Icons.Trash2 size={14} />,
              danger: true,
              onSelect: () => void desk()?.removeProgram?.(p.id).then(keep),
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
            keep(await desk()?.renameProgram?.(renaming.id, name));
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
