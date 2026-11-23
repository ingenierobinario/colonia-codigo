import { Button, Dialog } from "@colonia/ui";
import { usePack, useT } from "../i18n/index.ts";
import { closeHostingOffer, goToHosting, stopHostingReminder, useHostingReminder } from "./hostingOffer.ts";

export function HostingOfferDialog() {
  const ready = usePack("equipos");
  const t = useT();
  // RECORDATORIO-SERVIDOR-1 · El mismo diálogo sirve de aviso diario, con su propio texto y «No volver a recordar».
  const reminder = useHostingReminder();
  if (!ready) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeHostingOffer();
      }}
      title={t(reminder ? "equipos.reminderTitle" : "equipos.offerTitle")}
      description={t(reminder ? "equipos.reminderHint" : "equipos.offerHint")}
      footer={
        <>
          {reminder && (
            <Button variant="ghost" onClick={() => void stopHostingReminder()}>
              {t("equipos.reminderNever")}
            </Button>
          )}
          <Button variant="secondary" onClick={closeHostingOffer}>
            {t("equipos.offerLater")}
          </Button>
          <Button
            onClick={() => {
              closeHostingOffer();
              void goToHosting();
            }}
          >
            {t("equipos.offerSee")}
          </Button>
        </>
      }
    />
  );
}
