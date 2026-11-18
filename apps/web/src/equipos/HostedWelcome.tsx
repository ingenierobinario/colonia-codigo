import { Button, Dialog } from "@colonia/ui";
import { useCallback, useState } from "react";
import { finishSetup } from "../data/setup.ts";
import { usePack, useT } from "../i18n/index.ts";
import { HostingPair } from "./HostingPair.tsx";

export function HostedWelcome({ onNew }: { onNew: () => void }) {
  const [linked, setLinked] = useState(false);
  const [saving, setSaving] = useState(false);
  const markLinked = useCallback(() => setLinked(true), []);
  const ready = usePack("equipos");
  const t = useT();
  const openColonia = async () => {
    if (saving) return;
    setSaving(true);
    if (await finishSetup({ requireConfirmation: true })) onNew();
    else setSaving(false);
  };
  if (!ready) return null;
  return (
    <Dialog
      open
      title={t("equipos.hostingWelcome")}
      description={t("equipos.hostingWelcomeHint")}
      onOpenChange={(open) => {
        if (!open && !saving) onNew();
      }}
      footer={
        linked ? (
          <Button disabled={saving} onClick={() => void openColonia()}>
            {t("equipos.hostingOpen")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onNew}>
            {t("equipos.hostingNew")}
          </Button>
        )
      }
    >
      <HostingPair onPaired={markLinked} />
    </Dialog>
  );
}
