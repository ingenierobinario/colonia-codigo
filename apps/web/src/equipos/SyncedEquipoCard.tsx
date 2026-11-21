// INVENTARIO-EQUIPOS-1 y SYNC-CADA-1 · La ficha del equipo sincronizado con este (otro ordenador o un servidor): qué es,
// qué versión lleva, si está a la vista, cuándo se pusieron al día, qué tienen en común y cada cuánto se mandan los
// cambios, con «Sincronizar ahora» aquí mismo.
import type { SyncStatus } from "@colonia/protocol";
import { Badge, Button, Icons, SegmentedControl } from "@colonia/ui";
import { useState } from "react";
import { formatNumber, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** El id con el que la barra lateral lleva a esta ficha. */
export const SYNCED_EQUIPO_ID = "equipo-sincronizado";

const SYSTEM: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
const EVERY: { value: string; key: MessageKey }[] = [
  { value: "0", key: "equipos.syncEvery.now" },
  { value: "5", key: "equipos.syncEvery.5" },
  { value: "60", key: "equipos.syncEvery.60" },
  { value: "-1", key: "equipos.syncEvery.manual" },
];
const SHARED: { k: keyof NonNullable<SyncStatus["shared"]>; key: MessageKey }[] = [
  { k: "projects", key: "equipos.shared.projects" },
  { k: "agents", key: "equipos.shared.agents" },
  { k: "flows", key: "equipos.shared.flows" },
  { k: "routines", key: "equipos.shared.routines" },
  { k: "channels", key: "equipos.shared.channels" },
  { k: "apps", key: "equipos.shared.apps" },
];

export function SyncedEquipoCard({ s, onChange }: { s: SyncStatus; onChange: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!s.paired || !s.peer) return null;
  const peer = s.peer;
  const server = peer.kind === "servidor";
  const every = String(s.every_min ?? 0);
  const run = (f: () => Promise<SyncStatus>) => {
    setBusy(true);
    setFailed(false);
    void f()
      .then(() => onChange())
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  const state = s.mismatch
    ? t("equipos.synced.mismatch")
    : s.connected
      ? t("equipos.synced.online")
      : peer.seen_at
        ? t("equipos.synced.seen", { when: shortWhen(peer.seen_at) })
        : t("equipos.synced.offline");
  const sharedList = SHARED.filter((x) => (s.shared?.[x.k] ?? 0) > 0);
  const next =
    s.every_min === -1
      ? t("equipos.syncEvery.manualHint")
      : s.every_min === 0
        ? t("equipos.syncEvery.nowHint")
        : s.next_sync_at
          ? t("equipos.syncEvery.next", { when: shortWhen(s.next_sync_at) })
          : t("equipos.syncEvery.waiting");
  return (
    <section className="eq-card eq-synced" data-equipo-id={SYNCED_EQUIPO_ID} aria-label={peer.name}>
      <div className="eq-row">
        <span className="eq-name">
          <span className={`eq-dot${s.connected && !s.mismatch ? " eq-dot--on" : ""}`} />
          {server ? <Icons.Server /> : <Icons.Monitor />}
          <strong>{peer.name}</strong>
        </span>
        <Badge tone={s.mismatch ? "warning" : "neutral"}>
          {t(server ? "equipos.synced.server" : "equipos.synced.pc")}
        </Badge>
      </div>
      <dl className="eq-facts">
        <div className="eq-fact">
          <dt>{t("equipos.thisState")}</dt>
          <dd>{state}</dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.synced.last")}</dt>
          <dd>{s.last_sync_at ? shortWhen(s.last_sync_at) : t("equipos.synced.never")}</dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.synced.pending")}</dt>
          <dd>
            {s.pending > 0
              ? t("equipos.synced.pendingN", { n: formatNumber(s.pending) })
              : t("equipos.synced.upToDate")}
          </dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.synced.version")}</dt>
          <dd>{peer.version || t("equipos.synced.unknown")}</dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.thisSystem")}</dt>
          <dd>{(peer.platform && SYSTEM[peer.platform]) || peer.platform || t("equipos.synced.unknown")}</dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.synced.role")}</dt>
          <dd title={t("equipos.synced.roleHint")}>
            {t(s.role === "secundario" ? "equipos.synced.rolePeer" : "equipos.synced.roleThis")}
          </dd>
        </div>
      </dl>
      <div className="eq-synced__shared">
        <span className="eq-muted">{t("equipos.shared.title")}</span>
        {sharedList.length ? (
          <ul className="eq-synced__chips">
            {sharedList.map((x) => (
              <li key={x.k} className="eq-synced__chip">
                <strong>{formatNumber(s.shared?.[x.k] ?? 0)}</strong> {t(x.key)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="eq-muted">{t("equipos.shared.none")}</span>
        )}
      </div>
      <div className="eq-synced__every">
        <div className="eq-synced__everyText">
          <strong>{t("equipos.syncEvery.title")}</strong>
          <span className="eq-muted">{failed ? t("equipos.syncEvery.failed") : next}</span>
        </div>
        <div className="eq-synced__actions">
          <SegmentedControl
            label={t("equipos.syncEvery.title")}
            value={every}
            onValueChange={(v) => run(() => client.call("sync.set_every", { minutes: Number(v) as 0 | 5 | 60 | -1 }))}
            options={EVERY.map((o) => ({ value: o.value, label: t(o.key) }))}
          />
          <Button variant="outline" disabled={busy} onClick={() => run(() => client.call("sync.now", {}))}>
            <Icons.RefreshCw size={14} /> {t("equipos.syncNow")}
          </Button>
        </div>
      </div>
    </section>
  );
}
