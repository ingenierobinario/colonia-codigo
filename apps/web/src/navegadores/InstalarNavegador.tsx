// INSTALAR-NAV-1: the card under "Navegadores" while a browser is being installed: what is happening, what the owner
// has to do (if anything), and, when it could not be done, the maker's own page.
import { Button, IconButton, Icons } from "@colonia/ui";
import type { BrowserInstallProgress } from "../colonia-desktop.d.ts";
import { useT } from "../i18n/index.ts";
import { BrowserLogo } from "./BrowserLogo.tsx";
import { installBusy, installLine } from "./instalar.ts";
import "../styles/navegadores-install.css";

export function InstalarNavegador({
  progress,
  onCancel,
  onClose,
  onOpenPage,
}: {
  progress: BrowserInstallProgress;
  onCancel: () => void;
  onClose: () => void;
  onOpenPage: () => void;
}) {
  const t = useT();
  const busy = installBusy(progress);
  const { name } = progress;
  const title =
    progress.phase === "done"
      ? t("navegadores.installedTitle", { name })
      : progress.phase === "failed"
        ? t("navegadores.installFailedTitle", { name })
        : t("navegadores.installing", { name });
  return (
    <div className="navinstall" role="status" aria-live="polite">
      <BrowserLogo browser={progress.id} size={20} />
      <div className="navinstall__body">
        <strong className="navinstall__title">{title}</strong>
        <p>{t(installLine(progress), { name, percent: progress.percent ?? 0 })}</p>
        {busy &&
          (progress.phase === "downloading" && progress.percent != null ? (
            <progress max={100} value={progress.percent} aria-label={title} />
          ) : (
            <progress aria-label={title} />
          ))}
        {busy && (
          <div className="navinstall__actions">
            <Button size="sm" variant="secondary" onClick={onCancel}>
              {t("navegadores.installCancel")}
            </Button>
          </div>
        )}
        {progress.phase === "failed" && progress.page && (
          <div className="navinstall__actions">
            <Button size="sm" variant="secondary" leadingIcon={<Icons.ExternalLink size={14} />} onClick={onOpenPage}>
              {t("navegadores.installOpenPage", { name })}
            </Button>
          </div>
        )}
      </div>
      {!busy && (
        <IconButton
          size="sm"
          className="navinstall__close"
          label={t("navegadores.installClose")}
          icon={<Icons.X size={14} />}
          onClick={onClose}
        />
      )}
    </div>
  );
}
