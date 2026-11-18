// COPIA-COMPLETA-1 · Crear una copia: contraseña dos veces, dónde se guarda, y cómo va.
import type { BackupStatus } from "@colonia/protocol";
import { Button, Checkbox, Field, IconButton, Icons, Input } from "@colonia/ui";
import { useState } from "react";
import { formatBytes } from "../common/format.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { BackupCard, Note, PasswordInput, Progress, whyKey } from "./BackupParts.tsx";

export function BackupCreate({ status, onStatus }: { status: BackupStatus; onStatus: (s: BackupStatus) => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [folder, setFolder] = useState<string>();
  const [includeWork, setIncludeWork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = status.kind === "create";
  const working = status.state === "working";
  const short = password.length > 0 && password.length < 8;
  const mismatch = again.length > 0 && again !== password;
  const can = password.length >= 8 && again === password && !working && !busy;
  const where = folder ?? status.folder;

  const start = async () => {
    if (!can) return;
    setBusy(true);
    try {
      const dir = folder?.trim();
      const next = await client.call("backup.create", {
        password,
        ...(dir ? { folder: dir } : {}),
        ...(includeWork ? { include_work: true } : {}),
      });
      if (next.why === "busy") return notify(t("backup.why.busy"));
      onStatus(next);
      if (next.state !== "failed") {
        setPassword("");
        setAgain("");
      }
    } catch {
      notify(t("backup.why.failed"));
    } finally {
      setBusy(false);
    }
  };
  const pick = async () => {
    const dir = await window.coloniaDesktop?.pickFolder?.();
    if (dir) setFolder(dir);
  };

  return (
    <BackupCard name="create" icon={<Icons.Archive />} title={t("backup.create.title")} hint={t("backup.create.hint")}>
      <div className="bk-fields">
        <Field label={t("backup.password")} error={short ? t("backup.short") : undefined}>
          {(id) => (
            <PasswordInput
              id={id}
              name="backup-password"
              value={password}
              onChange={setPassword}
              invalid={short}
              disabled={working}
            />
          )}
        </Field>
        <Field label={t("backup.repeat")} error={mismatch ? t("backup.mismatch") : undefined}>
          {(id) => (
            <PasswordInput
              id={id}
              name="backup-password-again"
              value={again}
              onChange={setAgain}
              invalid={mismatch}
              disabled={working}
              onEnter={() => void start()}
            />
          )}
        </Field>
      </div>
      <p className="bk-hint">{t("backup.passwordHint")}</p>
      <Field label={t("backup.folder")}>
        {(id) => (
          <Input
            id={id}
            name="backup-folder"
            value={where}
            disabled={working}
            onChange={(e) => setFolder(e.currentTarget.value)}
            leadingIcon={<Icons.Folder />}
            trailing={
              window.coloniaDesktop?.pickFolder ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t("backup.folderPick")}
                  onClick={() => void pick()}
                  icon={<Icons.FolderOpen />}
                />
              ) : undefined
            }
          />
        )}
      </Field>
      <Checkbox
        checked={includeWork}
        onCheckedChange={setIncludeWork}
        disabled={working}
        label={t("backup.includeWork")}
      />
      {mine && working && <Progress status={status} />}
      {mine && status.state === "failed" && <Note tone="error">{t(whyKey(status.why))}</Note>}
      {mine && status.state === "done" && status.file && (
        <div className="bk-result" data-bk="created">
          <Note tone="ok">
            <b>{t("backup.created")}</b>
            <span className="bk-result__meta">{t("backup.createdHint", { size: formatBytes(status.bytes ?? 0) })}</span>
          </Note>
          <div className="bk-path">
            <code className="bk-path__text" title={status.file}>
              {status.file}
            </code>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={copied ? <Icons.Check /> : <Icons.Copy />}
              onClick={() => {
                void navigator.clipboard?.writeText(status.file ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {t(copied ? "backup.copied" : "backup.copyPath")}
            </Button>
          </div>
        </div>
      )}
      <div className="bk-actions">
        <Button data-bk="create-go" loading={busy || (mine && working)} disabled={!can} onClick={() => void start()}>
          {t("backup.create.go")}
        </Button>
      </div>
    </BackupCard>
  );
}
