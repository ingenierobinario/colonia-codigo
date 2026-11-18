// COPIA-COMPLETA-1 · Ajustes › Copia y traslado (DECISIONS.md#d-192): crear la copia completa de Colonia, restaurarla en
// este equipo, y decir con nombre lo que hay que volver a vincular después.
import "../styles/backup.css";
import type { BackupRestored, BackupStatus } from "@colonia/protocol";
import { Button, Icons } from "@colonia/ui";
import { useCallback, useEffect, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { BackupCreate } from "./BackupCreate.tsx";
import { Counts } from "./BackupParts.tsx";
import { BackupRestore } from "./BackupRestore.tsx";
import { SectionHead } from "./SectionHead.tsx";

const EVERY_MS = 700;

export function BackupSection() {
  const ready = usePack("backup");
  const t = useT();
  const target = useNav((s) => s.backupTarget);
  const [status, setStatus] = useState<BackupStatus>();
  const read = useCallback(async () => {
    // Mientras Colonia se reinicia no contesta: se queda lo último que se supo.
    await client.call("backup.status", {}).then(setStatus, () => {});
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  // Se pregunta cómo va mientras hay algo en marcha, y mientras Colonia se reinicia sola tras restaurar.
  const restarting = status?.kind === "restore" && status.state === "done" && status.restart === "auto";
  const watching = status?.state === "working" || restarting;
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => void read(), EVERY_MS);
    return () => clearInterval(id);
  }, [watching, read]);

  if (!ready) return null;
  if (!status) return <SectionHead title={t("config.backup")} lead={t("backup.lead")} />;
  const dismiss = async () => {
    await client.call("backup.dismiss", {}).catch(() => {});
    await read();
  };
  const restore = (
    <BackupRestore
      status={status}
      onStatus={setStatus}
      listKey={status.kind === "create" && status.state === "done" ? (status.file ?? "") : ""}
    />
  );
  return (
    <>
      <SectionHead title={t("config.backup")} lead={t("backup.lead")} />
      {status.restored && <Restored restored={status.restored} onDismiss={() => void dismiss()} />}
      {target === "restore" && restore}
      <BackupCreate
        key={typeof target === "object" ? target.project : "installation"}
        status={status}
        onStatus={setStatus}
        initialProject={typeof target === "object" ? target.project : undefined}
      />
      {target !== "restore" && restore}
      <details className="bk-what">
        <summary className="bk-what__summary">
          <Icons.ChevronRight />
          {t("backup.what")}
        </summary>
        <div className="bk-what__cols">
          <div>
            <h4 className="bk-what__title">{t("backup.travels")}</h4>
            <ul className="bk-what__list">
              <li>{t("backup.travel.data")}</li>
              <li>{t("backup.travel.ai")}</li>
              <li>{t("backup.travel.channels")}</li>
              <li>{t("backup.travel.settings")}</li>
            </ul>
          </div>
          <div>
            <h4 className="bk-what__title">{t("backup.stays")}</h4>
            <ul className="bk-what__list">
              <li>{t("backup.stay.sessions")}</li>
              <li>{t("backup.stay.logins")}</li>
              <li>{t("backup.stay.external")}</li>
              <li>{t("backup.stay.models")}</li>
              <li>{t("backup.stay.devices")}</li>
            </ul>
          </div>
        </div>
      </details>
    </>
  );
}

/** Lo que quedó tras restaurar: de dónde vino, qué hay que volver a vincular y dónde está lo que había antes. */
function Restored({ restored, onDismiss }: { restored: BackupRestored; onDismiss: () => void }) {
  const t = useT();
  return (
    <section className="bk-card bk-card--done" data-bk="restored">
      <header className="bk-card__head">
        <span className="bk-card__icon" aria-hidden="true">
          <Icons.Check />
        </span>
        <div className="bk-card__titles">
          <h3 className="bk-card__title">{t("backup.done.title")}</h3>
          <p className="bk-card__hint">
            {t("backup.done.from", { host: restored.host, when: shortWhen(restored.at) })}
          </p>
        </div>
      </header>
      <Counts summary={restored.summary} />
      <ul className="bk-todo">
        {restored.relink.length > 0 && (
          <li className="bk-todo__item" data-bk="relink">
            <Icons.RefreshCw />
            <span className="bk-todo__text">
              {t("backup.done.relink", { names: restored.relink.map((c) => c.name).join(", ") })}
            </span>
            <Button size="sm" variant="secondary" onClick={() => go.config("channels")}>
              {t("backup.done.relinkGo")}
            </Button>
          </li>
        )}
        {(restored.secrets_failed?.length ?? 0) > 0 && (
          <li className="bk-todo__item" data-bk="secrets-failed">
            <Icons.Shield />
            <span className="bk-todo__text">
              {t("backup.done.secretsFailed", { names: restored.secrets_failed?.join(", ") ?? "" })}
            </span>
          </li>
        )}
        {restored.browsers > 0 && (
          <li className="bk-todo__item" data-bk="relogin">
            <Icons.Globe />
            <span className="bk-todo__text">{t("backup.done.relogin")}</span>
          </li>
        )}
        {restored.safety && (
          <li className="bk-todo__item" data-bk="safety">
            <Icons.Shield />
            <span className="bk-todo__text" title={restored.safety}>
              {t("backup.done.safety", { file: restored.safety })}
            </span>
          </li>
        )}
      </ul>
      <div className="bk-actions">
        <Button data-bk="dismiss" variant="secondary" onClick={onDismiss}>
          {t("backup.done.ok")}
        </Button>
      </div>
    </section>
  );
}
