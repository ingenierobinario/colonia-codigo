import { Button, Icons } from "@colonia/ui";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

export function TransferActions() {
  const t = useT();
  return (
    <section className="eq-card eq-card--static eq-transfer" aria-label={t("equipos.transfer")}>
      <h2 className="eq-transfer__title">{t("equipos.transfer")}</h2>
      <div className="eq-transfer__options">
        <div>
          <Button variant="secondary" leadingIcon={<Icons.RefreshCw />} onClick={() => go.config("sync")}>
            {t("config.sync")}
          </Button>
          <p className="eq-muted">{t("equipos.transferSync")}</p>
        </div>
        <div>
          <Button variant="secondary" leadingIcon={<Icons.Archive />} onClick={() => go.config("backup")}>
            {t("config.backup")}
          </Button>
          <p className="eq-muted">{t("equipos.transferBackup")}</p>
        </div>
      </div>
    </section>
  );
}
