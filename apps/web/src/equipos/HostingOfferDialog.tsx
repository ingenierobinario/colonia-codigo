import { Button, Dialog } from "@colonia/ui";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { closeHostingOffer } from "./hostingOffer.ts";

export function HostingOfferDialog() {
  const ready = usePack("equipos");
  const t = useT();
  if (!ready) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeHostingOffer();
      }}
      title={t("equipos.offerTitle")}
      description={t("equipos.offerHint")}
      footer={
        <>
          <Button variant="secondary" onClick={closeHostingOffer}>
            {t("equipos.offerLater")}
          </Button>
          <Button
            onClick={() => {
              closeHostingOffer();
              go.view("equipos");
              go.focus("servidor-continuo");
            }}
          >
            {t("equipos.offerSee")}
          </Button>
        </>
      }
    />
  );
}
