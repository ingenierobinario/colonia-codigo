// COPIA-COMPLETA-1 · Restaurar en este equipo: elegir la copia, ver lo que trae y decidir qué pasa con lo que hay.
import type { BackupFile, BackupInspect, BackupStatus } from "@colonia/protocol";
import { Button, Field, IconButton, Icons, Input, SegmentedControl, Select } from "@colonia/ui";
import { useEffect, useState } from "react";
import { formatBytes, formatNumber, shortWhen } from "../common/format.ts";
import { bootstrap } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { BackupCard, Counts, Note, PasswordInput, Progress, type Why, whyKey } from "./BackupParts.tsx";

type Found = Extract<BackupInspect, { ok: true }>;
type Mode = "replace" | "merge";
const OTHER = "\u0000otro";

export function BackupRestore({
  status,
  onStatus,
  listKey,
}: {
  status: BackupStatus;
  onStatus: (s: BackupStatus) => void;
  /** Cambia cuando hay una copia nueva que listar. */
  listKey: string;
}) {
  const t = useT();
  const [copies, setCopies] = useState<BackupFile[]>();
  const [picked, setPicked] = useState<string>();
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [review, setReview] = useState<{ file: string; password: string; details: Found }>();
  const found = review?.details;
  const [destination, setDestination] = useState("");
  const [dismissedProject, setDismissedProject] = useState<string>();
  const [why, setWhy] = useState<Why>();
  const [mode, setMode] = useState<Mode>("replace");
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: listKey is the reason to read the list again.
  useEffect(() => {
    void client.call("backup.list", {}).then(
      (r) => setCopies(r.copies),
      () => setCopies([]),
    );
  }, [listKey]);

  const mine = status.kind === "restore";
  const working = status.state === "working";
  const imported = mine && status.state === "done" ? status.imported_project : undefined;
  const prepared = mine && status.state === "done" && (!imported || imported.id !== dismissedProject);
  const choice = picked ?? copies?.[0]?.file ?? OTHER;
  const file = choice === OTHER ? typed.trim() : choice;
  const can = Boolean(file) && password.length > 0 && !busy && !working;

  const inspect = async () => {
    if (!can) return;
    setBusy(true);
    setWhy(undefined);
    try {
      const r = await client.call("backup.inspect", { file, password });
      if (r.ok) {
        setReview({ file, password, details: r });
        setDestination("");
        setMode("replace");
      } else setWhy(r.why);
    } catch {
      setWhy("failed");
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!found || !review || busy || working) return;
    setBusy(true);
    try {
      const dir = destination.trim();
      const next = await client.call("backup.restore", {
        file: review.file,
        password: review.password,
        mode: found.scope ? "merge" : found.has_data ? mode : "replace",
        ...(found.scope && dir ? { destination: dir } : {}),
      });
      if (next.why === "busy") return notify(t("backup.why.busy"));
      onStatus(next);
    } catch {
      notify(t("backup.why.failed"));
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    setReview(undefined);
    setWhy(undefined);
  };
  const openImported = async () => {
    if (!imported || busy) return;
    setBusy(true);
    try {
      await bootstrap();
      go.config(null);
      go.project(imported.id);
    } catch {
      notify(t("backup.openFailed"));
    } finally {
      setBusy(false);
    }
  };

  const options = [
    ...(copies ?? []).map((c) => ({
      value: c.file,
      label: c.name,
      hint: t("backup.fileMeta", { size: formatBytes(c.size), when: shortWhen(c.modified_at) }),
      description: c.folder,
    })),
    { value: OTHER, label: t("backup.fileOther") },
  ];

  return (
    <BackupCard
      name="restore"
      icon={<Icons.ArchiveRestore />}
      title={t("backup.restore.title")}
      hint={t("backup.restore.hint")}
    >
      {prepared && imported ? (
        <div className="bk-result" data-bk="project-restored">
          <Note tone="ok">
            <b>{t("backup.projectDone")}</b>
            <span className="bk-project-name">{imported.name}</span>
          </Note>
          <code className="bk-path__text">{imported.path}</code>
          <div className="bk-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setDismissedProject(imported.id);
                setPassword("");
                back();
              }}
            >
              {t("backup.another")}
            </Button>
            <Button loading={busy} onClick={() => void openImported()}>
              {t("backup.openProject")}
            </Button>
          </div>
        </div>
      ) : prepared ? (
        <Note tone="ok">{t(status.restart === "auto" ? "backup.restart.auto" : "backup.restart.manual")}</Note>
      ) : mine && working ? (
        <Progress status={status} />
      ) : found ? (
        <div className="bk-review" data-bk="review">
          <div className="bk-review__head">
            <b>{t(found.scope ? "backup.projectPreview" : "backup.brings")}</b>
            {found.scope && <strong className="bk-project-name">{found.scope.name}</strong>}
            <span className="bk-review__from">
              {found.scope
                ? t("backup.projectFrom", {
                    host: found.host,
                    when: shortWhen(found.created_at),
                    files: formatNumber(found.files),
                    size: formatBytes(found.bytes),
                  })
                : t("backup.from", {
                    host: found.host,
                    when: shortWhen(found.created_at),
                    keys: formatNumber(found.keys),
                  })}
            </span>
          </div>
          <Counts summary={found.summary} project={Boolean(found.scope)} />
          {!found.scope && found.relink.length > 0 && (
            <Note tone="warn">{t("backup.relink", { names: found.relink.map((c) => c.name).join(", ") })}</Note>
          )}
          {!found.scope && found.summary.browsers + found.summary.apps > 0 && (
            <Note tone="warn">{t("backup.relogin")}</Note>
          )}
          {found.scope ? (
            <>
              <p className="bk-hint">{t("backup.projectRestoreHint")}</p>
              <Field label={t("backup.projectDestination")}>
                {(id) => (
                  <Input
                    id={id}
                    name="backup-project-destination"
                    value={destination}
                    placeholder={t("backup.defaultDestination")}
                    disabled={busy}
                    onChange={(e) => setDestination(e.currentTarget.value)}
                    trailing={
                      window.coloniaDesktop?.pickFolder ? (
                        <IconButton
                          size="sm"
                          variant="ghost"
                          label={t("backup.folderPick")}
                          icon={<Icons.FolderOpen />}
                          onClick={async () => {
                            const dir = await window.coloniaDesktop?.pickFolder?.();
                            if (dir) setDestination(dir);
                          }}
                        />
                      ) : undefined
                    }
                  />
                )}
              </Field>
            </>
          ) : found.has_data ? (
            <div className="bk-mode">
              <span className="bk-mode__label">{t("backup.mode")}</span>
              <SegmentedControl
                size="sm"
                label={t("backup.mode")}
                value={mode}
                onValueChange={(v) => setMode(v === "merge" ? "merge" : "replace")}
                options={[
                  { value: "replace", label: t("backup.mode.replace") },
                  { value: "merge", label: t("backup.mode.merge") },
                ]}
              />
              <p className="bk-hint" data-bk="mode-hint">
                {t(mode === "merge" ? "backup.mode.mergeHint" : "backup.mode.replaceHint")}
              </p>
            </div>
          ) : (
            <p className="bk-hint">{t("backup.emptyHere")}</p>
          )}
          {mine && status.state === "failed" && <Note tone="error">{t(whyKey(status.why))}</Note>}
          <div className="bk-actions">
            <Button variant="secondary" disabled={busy} onClick={back}>
              {t("backup.restore.back")}
            </Button>
            <Button data-bk="restore-go" loading={busy} onClick={() => void restore()}>
              {t(found.scope ? "backup.restoreProject" : "backup.restore.go")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {copies && copies.length > 0 ? (
            <Field label={t("backup.file")}>
              <Select
                label={t("backup.file")}
                value={choice}
                options={options}
                onValueChange={(v) => setPicked(v ?? OTHER)}
              />
            </Field>
          ) : (
            copies && <p className="bk-hint">{t("backup.noCopies")}</p>
          )}
          <div className="bk-fields">
            {choice === OTHER && (
              <Field label={t("backup.filePath")}>
                {(id) => (
                  <Input
                    id={id}
                    name="backup-file"
                    value={typed}
                    placeholder={t("backup.filePlaceholder")}
                    onChange={(e) => setTyped(e.currentTarget.value)}
                  />
                )}
              </Field>
            )}
            <Field label={t("backup.restorePassword")}>
              {(id) => (
                <PasswordInput
                  id={id}
                  name="backup-restore-password"
                  value={password}
                  onChange={setPassword}
                  invalid={why === "password"}
                  onEnter={() => void inspect()}
                />
              )}
            </Field>
          </div>
          {why && <Note tone="error">{t(whyKey(why))}</Note>}
          <div className="bk-actions">
            <Button
              data-bk="inspect-go"
              variant="secondary"
              loading={busy}
              disabled={!can}
              onClick={() => void inspect()}
            >
              {t("backup.inspect")}
            </Button>
          </div>
        </>
      )}
    </BackupCard>
  );
}
