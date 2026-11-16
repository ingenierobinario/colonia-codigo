import { Button, Dialog, Icons, Spinner } from "@colonia/ui";
import { notify } from "../data/notices.ts";
import { notesFor } from "../data/update-notes.ts";
import { packageCommandOf } from "../data/update-target.ts";
import { applyUpdate, closeUpdate, loadUpdates, restartApp, updatedByApp, useUpdates } from "../data/updates.ts";
import { useLanguage, useT } from "../i18n/index.ts";

/** The update dialog (from the pill or the corner card): what changed, and "Update now". */
export function UpdateDialog() {
  const t = useT();
  const language = useLanguage();
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const target = useUpdates((s) => s.target);
  const own = useUpdates((s) => s.phase);
  const log = useUpdates((s) => s.log);
  const close = () => {
    if (phase === "updating" || phase === "restarting") return;
    closeUpdate();
  };
  // Started from the app menu, the app may already be downloading it, or have it ready.
  const phase = target === "app" && own === "idle" ? (app?.ready ? "ready" : app?.downloading ? "updating" : own) : own;
  const changes =
    target === "core"
      ? notesFor(status?.localized, status?.changes, language)
      : notesFor(app?.localized, app?.notes, language);
  const drag = target === "app" && app?.install === "drag";
  const linux = window.coloniaDesktop?.platform === "linux";
  const byApp = updatedByApp(status, target);
  // UPDATE-PAQUETE-1 · From a .deb or .rpm the new package goes in with one command: it is said here, ready to copy.
  const command = phase === "ready" || phase === "done" ? packageCommandOf(app, target) : undefined;
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command ?? "");
      notify(t("files.copied"), "info");
    } catch {
      notify(t("files.copyFailed"));
    }
  };
  const lead = command
    ? t("update.leadPackage", { v: app?.latest ?? app?.ready ?? "" })
    : target === "both"
      ? t("update.leadBoth", { v: app?.latest ?? app?.ready ?? "", current: app?.current ?? "" })
      : target === "app"
        ? phase === "ready" || phase === "restarting" || phase === "stalled"
          ? t("update.leadReady", { v: app?.ready ?? app?.latest ?? "" })
          : t(drag ? (linux ? "update.leadAppDragLinux" : "update.leadAppDrag") : "update.leadApp", { v: app?.latest ?? "", current: app?.current ?? "" })
        : byApp
          ? t("update.leadByApp", { v: status?.latest ?? "" })
          : status?.source === "release"
            ? t("update.leadRelease", { v: status.latest ?? "" })
            : t("update.lead", { n: status?.behind ?? 0 });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("update.title")}
      description={lead}
      footer={
        phase === "idle" ? (
          <>
            <Button variant="secondary" onClick={() => void loadUpdates(true)}>
              {t("update.check")}
            </Button>
            {byApp ? (
              <Button onClick={close}>{t("common.close")}</Button>
            ) : (
              <Button onClick={() => void applyUpdate()}>{t(drag ? "update.download" : "update.now")}</Button>
            )}
          </>
        ) : phase === "ready" ? (
          <>
            <Button variant="secondary" onClick={close}>
              {t("update.later")}
            </Button>
            <Button onClick={() => void restartApp()}>{t("update.restartNow")}</Button>
          </>
        ) : phase === "done" || phase === "failed" || phase === "stalled" ? (
          <Button variant="secondary" onClick={close}>
            {t("common.close")}
          </Button>
        ) : undefined
      }
    >
      {phase === "idle" && changes.length > 0 && (
        <ul className="update__changes">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {(phase === "updating" || phase === "restarting") && (
        <div className="update__wait">
          <Spinner size={16} />
          {t(
            phase === "updating"
              ? target === "app"
                ? "update.downloading"
                : target === "both"
                  ? "update.updatingBoth"
                  : "update.updating"
              : "update.restarting",
          )}
        </div>
      )}
      {command && (
        <>
          <p className="update__note">{t("update.packageSteps")}</p>
          <div className="update__command">
            {/* Whole, on as many lines as it needs: a cut command is one nobody can check before pasting it. */}
            <code className="update__command-text" title={t("update.packageCommand")}>
              {command}
            </code>
            <Button variant="secondary" leadingIcon={<Icons.Copy size={14} />} onClick={() => void copyCommand()}>
              {t("update.packageCopy")}
            </Button>
          </div>
          <p className="update__note">{t("update.packageAfter")}</p>
        </>
      )}
      {phase === "ready" && !command && (
        <p className="update__note">
          {t(window.coloniaDesktop?.platform === "win32" ? "update.readyLaterMenu" : "update.readyLater")}
        </p>
      )}
      {phase === "stalled" && <p className="update__note">{t("update.restartStalled")}</p>}
      {phase === "done" && !command && <p className="update__note">{t(drag ? (linux ? "update.dragDoneLinux" : "update.dragDone") : "update.done")}</p>}
      {phase === "failed" && (
        <>
          <p className="update__note">{t("update.failed")}</p>
          {log && <pre className="update__log">{log}</pre>}
        </>
      )}
    </Dialog>
  );
}
