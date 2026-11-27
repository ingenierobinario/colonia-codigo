import { secureRequestKey } from "@colonia/protocol/client";
import { Button, Dialog, Field, Input } from "@colonia/ui";
import { useRef, useState } from "react";
import { renameWorkspace } from "../data/workspaces.ts";
import { useT } from "../i18n/index.ts";

export function RenameWorkspace({
  workspace,
  initialName,
  onClose,
  onSaved,
}: {
  workspace: string;
  initialName: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const request = useRef<{ name: string; key: string } | undefined>(undefined);
  const save = async () => {
    if (pending.current || !name.trim()) return;
    if (!request.current || request.current.name !== name.trim())
      request.current = { name: name.trim(), key: secureRequestKey() };
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await renameWorkspace(workspace, request.current.name, request.current.key);
      onSaved(request.current.name);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={t("office.rename")}
      description={t("office.renameHint")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <Button disabled={busy || !name.trim()} onClick={() => void save()}>
          {t(busy ? "common.loading" : "office.saveName")}
        </Button>
      }
    >
      <Field label={t("office.workspaceName")}>
        <Input
          autoFocus
          maxLength={80}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </Field>
      {error && <p role="alert">{t("office.failed")}</p>}
    </Dialog>
  );
}
