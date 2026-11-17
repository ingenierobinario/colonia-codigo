import type { Equipo } from "@colonia/protocol";
import { Button, Field, Input } from "@colonia/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

export function RemoteFolder({ equipo }: { equipo: Equipo }) {
  const t = useT();
  const [path, setPath] = useState(".");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [listing, setListing] = useState<{ output: string; truncated: boolean }>();
  const inspect = async () => {
    if (busy || !path.trim()) return;
    setListing(undefined);
    setFailed(false);
    setBusy(true);
    try {
      setListing(await client.call("equipos.list_files", { equipo: equipo.id, path: path.trim() }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="eq-inspect">
      <summary>{t("equipos.inspect")}</summary>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void inspect();
        }}
      >
        <Field label={t("equipos.remoteFolder")}>
          {(id) => (
            <Input
              id={id}
              maxLength={1000}
              value={path}
              disabled={busy}
              onChange={(ev) => {
                setPath(ev.currentTarget.value);
                setListing(undefined);
                setFailed(false);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" loading={busy} disabled={busy || !path.trim()}>
          {t("equipos.showFiles")}
        </Button>
      </form>
      {failed && <p role="alert">{t("equipos.folderFailed")}</p>}
      {listing && (
        <div role="status">
          <pre>{listing.output.trim() || t("equipos.emptyFolder")}</pre>
          {listing.truncated && <p>{t("equipos.folderLimit")}</p>}
        </div>
      )}
    </details>
  );
}
