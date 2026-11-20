import type { SurfaceSummary } from "@colonia/protocol";
import { Button, Dialog, Input } from "@colonia/ui";
import { useState } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";

/** APPS-RENOMBRAR-1: renames what the owner sees of an artifact; its name (where it keeps its memory) stays. */
export function ArtifactRenameDialog({ surface, onClose }: { surface: SurfaceSummary; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(surface.title);
  const clean = title.trim();
  const ok = clean.length > 0 && clean.length <= 120;
  const save = async () => {
    if (!ok) return;
    if (clean !== surface.title) await setSurfaceFlags(surface.id, { title: clean });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("artifact.rename")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ok} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        aria-label={t("artifact.renameName")}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
    </Dialog>
  );
}
