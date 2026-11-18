// COPIA-COMPLETA-1 · Crear una copia: contraseña dos veces, dónde se guarda, y cómo va.
import type { BackupStatus } from "@colonia/protocol";
import { Button, Checkbox, Field, IconButton, Icons, Input } from "@colonia/ui";
import { useMemo, useState } from "react";
import { formatBytes } from "../common/format.ts";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { BackupCard, Note, PasswordInput, Progress, whyKey } from "./BackupParts.tsx";

const INSTALLATION = ":installation";

export function BackupCreate({
  status,
  onStatus,
  initialProject,
}: {
  status: BackupStatus;
  onStatus: (s: BackupStatus) => void;
  initialProject?: string | undefined;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [scope, setScope] = useState(initialProject ?? INSTALLATION);
  const project = projects.find((p) => p.id === scope && p.registered !== false);
  const single = scope !== INSTALLATION;
  const options = useMemo(
    () => [
      {
        value: INSTALLATION,
        label: t("backup.scope.all"),
        icon: <Icons.Archive className="bk-scope-option" size={16} />,
      },
      ...projects
        .filter((p) => p.registered !== false)
        .map((p) => ({
          value: p.id,
          label: p.name,
          icon: <Icons.Folder className="bk-scope-option" size={16} />,
        })),
    ],
    [projects, t],
  );
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
  const can = password.length >= 8 && again === password && !working && !busy && (!single || Boolean(project));
  const where = folder ?? status.folder;

  const start = async () => {
    if (!can) return;
    setBusy(true);
    try {
      const dir = folder?.trim();
      const next = await client.call("backup.create", {
        password,
        ...(dir ? { folder: dir } : {}),
        ...(single ? { project_id: scope } : includeWork ? { include_work: true } : {}),
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
    <BackupCard
      name="create"
      icon={<Icons.Archive />}
      title={t("backup.create.title")}
      hint={t("backup.create.choose")}
    >
      <Field label={t("backup.scope")}>
        <SearchSelect
          label={t("backup.scope")}
          className="bk-scope"
          value={scope}
          options={options}
          placeholder={t("backup.scope.missing")}
          emptyLabel={t("pickers.noMatch")}
          searchPlaceholder={t("pickers.searchProject")}
          disabled={working || busy}
          onValueChange={(v) => {
            if (v) setScope(v);
          }}
        />
      </Field>
      <p className="bk-hint">{t(single ? "backup.scope.projectHint" : "backup.create.hint")}</p>
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
      {!single && (
        <Checkbox
          checked={includeWork}
          onCheckedChange={setIncludeWork}
          disabled={working}
          label={t("backup.includeWork")}
        />
      )}
      {mine && working && <Progress status={status} />}
      {mine && status.state === "failed" && <Note tone="error">{t(whyKey(status.why))}</Note>}
      {mine && status.state === "done" && status.file && (status.scope?.project_id ?? INSTALLATION) === scope && (
        <div className="bk-result" data-bk="created">
          <Note tone="ok">
            <b className="bk-project-name">
              {status.scope ? t("backup.projectCreated", { name: status.scope.name }) : t("backup.created")}
            </b>
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
