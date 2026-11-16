// D-192 fase 2 · Ajustes › Sincronizar equipos (DECISIONS.md#d-192): enlazar los dos ordenadores del dueño con un
// código, ver cómo va, decidir cuál lleva los canales y recuperar la versión que perdió un cambio.
import "../styles/backup.css";
import "../styles/sync.css";
import type { SyncSaved, SyncStatus } from "@colonia/protocol";
import { Badge, Button, Dialog, Field, IconButton, Icons, Input, SegmentedControl } from "@colonia/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { BackupCard, Note } from "./BackupParts.tsx";
import { SectionHead } from "./SectionHead.tsx";

const PAGE = 10;

export function SyncSection() {
  const ready = usePack("sync");
  const t = useT();
  const [status, setStatus] = useState<SyncStatus>();
  const [beat, setBeat] = useState(0);
  const read = useCallback(async () => {
    await client.call("sync.status", {}).then(setStatus, () => {});
  }, []);
  useEffect(() => {
    void read();
  }, [read]);
  // El núcleo avisa cuando algo se mueve; varios avisos seguidos se leen una sola vez.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = watchEvents((ev) => {
      if (ev.type !== "sync.updated" || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        setBeat((n) => n + 1);
        void read();
      }, 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [read]);
  // Mientras hay un código a la vista o cambios por enviar, se mira cómo va.
  const watching = Boolean(status?.pairing) || (status?.paired && (status.pending > 0 || !status.connected));
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => void read(), 2000);
    return () => clearInterval(id);
  }, [watching, read]);

  if (!ready) return null;
  return (
    <>
      <SectionHead title={t("config.sync")} lead={t("sync.lead")} />
      {status && !status.paired && <Pair status={status} onStatus={setStatus} />}
      {status?.paired && (
        <>
          <Linked status={status} />
          <Role status={status} onStatus={setStatus} />
          <Saved status={status} beat={beat} onChanged={() => void read()} />
          <Unpair status={status} onStatus={setStatus} />
        </>
      )}
      <details className="bk-what" data-sy="what">
        <summary className="bk-what__summary">
          <Icons.ChevronRight />
          {t("sync.what")}
        </summary>
        <div className="bk-what__cols">
          <div>
            <h4 className="bk-what__title">{t("sync.travels")}</h4>
            <ul className="bk-what__list">
              <li>{t("sync.travel.data")}</li>
              <li>{t("sync.travel.ai")}</li>
              <li>{t("sync.travel.channels")}</li>
            </ul>
          </div>
          <div>
            <h4 className="bk-what__title">{t("sync.stays")}</h4>
            <ul className="bk-what__list">
              <li>{t("sync.stay.sessions")}</li>
              <li>{t("sync.stay.logins")}</li>
              <li>{t("sync.stay.folders")}</li>
              <li>{t("sync.stay.models")}</li>
            </ul>
          </div>
        </div>
      </details>
    </>
  );
}

type Set = (s: SyncStatus) => void;

/** Lo que contestó el núcleo, dicho en el idioma de la pantalla. */
function joinWhy(e: unknown): MessageKey {
  const said = e instanceof Error ? e.message : String(e);
  if (/no es correcto/.test(said)) return "sync.join.wrong";
  if (/no es válido/.test(said)) return "sync.join.invalid";
  if (/ya está emparejado/.test(said)) return "sync.join.taken";
  return "sync.join.failed";
}

/** Sin enlazar: este equipo enseña un código, o se escribe aquí el del otro. */
function Pair({ status, onStatus }: { status: SyncStatus; onStatus: Set }) {
  const t = useT();
  const [mode, setMode] = useState<"show" | "type">("show");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<MessageKey>();
  const [copied, setCopied] = useState(false);
  const pairing = status.pairing;

  const run = async (f: () => Promise<SyncStatus>, failed: (e: unknown) => MessageKey) => {
    setBusy(true);
    setWhy(undefined);
    try {
      onStatus(await f());
    } catch (e) {
      setWhy(failed(e));
    } finally {
      setBusy(false);
    }
  };
  const join = () => {
    const typed = code.trim();
    if (!typed || busy) return;
    const at = address.trim();
    void run(() => client.call("sync.pair_join", { code: typed, ...(at ? { address: at } : {}) }), joinWhy);
  };

  return (
    <BackupCard name="sync-pair" icon={<Icons.Link />} title={t("sync.pair.title")} hint={t("sync.pair.hint")}>
      {!pairing && (
        <SegmentedControl
          className="sy-modes"
          label={t("sync.pair.modes")}
          value={mode}
          onValueChange={(v) => {
            setMode(v === "type" ? "type" : "show");
            setWhy(undefined);
          }}
          options={[
            { value: "show", label: t("sync.pair.show") },
            { value: "type", label: t("sync.pair.type") },
          ]}
        />
      )}
      {pairing && (
        <div className="sy-code" data-sy="code">
          <span className="sy-code__label">{t("sync.pair.code")}</span>
          <code className="sy-code__text" data-sy="code-text">
            {pairing.code}
          </code>
          <span className="bk-hint">{t("sync.pair.expires", { when: shortWhen(pairing.expires_at) })}</span>
        </div>
      )}
      {mode === "show" && !status.reachable && (
        <Note tone="warn">
          {t("sync.pair.local")}
          <button type="button" className="sy-link" data-sy="devices" onClick={() => go.config("devices")}>
            {t("sync.pair.localGo")}
          </button>
        </Note>
      )}
      {!pairing && mode === "show" && <p className="bk-hint">{t("sync.pair.makeHint")}</p>}
      {!pairing && mode === "type" && (
        <>
          <Field label={t("sync.join.code")}>
            {(id) => (
              <Input
                id={id}
                name="sync-code"
                autoComplete="off"
                spellCheck={false}
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && join()}
                leadingIcon={<Icons.KeyRound />}
              />
            )}
          </Field>
          <details className="sy-more">
            <summary className="sy-more__summary">
              <Icons.ChevronRight />
              {t("sync.join.more")}
            </summary>
            <Field label={t("sync.join.address")}>
              {(id) => (
                <Input
                  id={id}
                  name="sync-address"
                  autoComplete="off"
                  spellCheck={false}
                  value={address}
                  disabled={busy}
                  title={t("sync.join.addressHint")}
                  onChange={(e) => setAddress(e.currentTarget.value)}
                  leadingIcon={<Icons.Monitor />}
                />
              )}
            </Field>
          </details>
        </>
      )}
      {why && <Note tone="error">{t(why)}</Note>}
      <div className="bk-actions">
        {pairing && (
          <>
            <Button
              data-sy="cancel"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => client.call("sync.pair_cancel", {}), () => "sync.failed")}
            >
              {t("sync.pair.cancel")}
            </Button>
            <Button
              data-sy="copy"
              leadingIcon={copied ? <Icons.Check /> : <Icons.Copy />}
              onClick={() => {
                void navigator.clipboard?.writeText(pairing.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {t(copied ? "sync.pair.copied" : "sync.pair.copy")}
            </Button>
          </>
        )}
        {!pairing && mode === "show" && (
          <Button
            data-sy="make"
            loading={busy}
            onClick={() => void run(() => client.call("sync.pair_start", {}), () => "sync.failed")}
          >
            {t("sync.pair.make")}
          </Button>
        )}
        {!pairing && mode === "type" && (
          <Button data-sy="join" loading={busy} disabled={!code.trim()} onClick={join}>
            {t("sync.join.go")}
          </Button>
        )}
      </div>
    </BackupCard>
  );
}

/** Enlazado: con quién, cómo va y cuándo fue la última vez. */
function Linked({ status }: { status: SyncStatus }) {
  const t = useT();
  const name = status.peer?.name ?? "";
  const state: MessageKey = status.mismatch
    ? "sync.state.mismatchShort"
    : !status.connected
      ? "sync.state.offlineShort"
      : status.pending > 0
        ? "sync.state.sending"
        : "sync.state.ok";
  const tone = status.mismatch ? "danger" : !status.connected ? "warning" : "brand";
  return (
    <section className={status.connected && !status.mismatch ? "bk-card bk-card--done" : "bk-card"} data-sy="linked">
      <header className="bk-card__head">
        <span className="bk-card__icon" aria-hidden="true">
          {status.connected ? <Icons.Monitor /> : <Icons.WifiOff />}
        </span>
        <div className="bk-card__titles">
          <h3 className="bk-card__title" data-sy="peer">
            {t("sync.with", { name })}
          </h3>
        </div>
      </header>
      <dl className="bk-counts sy-counts">
        <div className="bk-count" data-sy="state">
          <dd className="bk-count__n sy-count__badge">
            <Badge tone={tone} dot>
              {t(state)}
            </Badge>
          </dd>
          <dt className="bk-count__label">{t("sync.n.state")}</dt>
        </div>
        <div className="bk-count" data-sy="last">
          <dd className="bk-count__n sy-count__when">
            {status.last_sync_at ? shortWhen(status.last_sync_at) : t("sync.never")}
          </dd>
          <dt className="bk-count__label">{t("sync.n.last")}</dt>
        </div>
        <div className="bk-count" data-sy="pending">
          <dd className="bk-count__n">{formatNumber(status.pending)}</dd>
          <dt className="bk-count__label">{t("sync.n.pending")}</dt>
        </div>
        <div className="bk-count" data-sy="saved-n">
          <dd className="bk-count__n">{formatNumber(status.saved)}</dd>
          <dt className="bk-count__label">{t("sync.n.saved")}</dt>
        </div>
      </dl>
      {status.mismatch && <Note tone="error">{t("sync.state.mismatch")}</Note>}
      {!status.mismatch && !status.connected && <Note tone="warn">{t("sync.state.offline")}</Note>}
    </section>
  );
}

/** Cuál de los dos lleva los canales y las rutinas, y pasarlos a este. */
function Role({ status, onStatus }: { status: SyncStatus; onStatus: Set }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const here = status.role !== "secundario";
  const name = status.peer?.name ?? "";
  const take = async () => {
    setBusy(true);
    try {
      onStatus(await client.call("sync.make_principal", {}));
    } catch {
      notify(t("sync.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bk-card" data-sy="role" data-role={here ? "here" : "there"}>
      <header className="bk-card__head">
        <span className="bk-card__icon" aria-hidden="true">
          <Icons.Crown />
        </span>
        <div className="bk-card__titles">
          <h3 className="bk-card__title">{t("sync.role.title")}</h3>
          <p className="bk-card__hint" title={t("sync.role.takeHint")}>
            {here ? t("sync.role.here") : t("sync.role.there", { name })}
          </p>
        </div>
      </header>
      <div className="sy-role">
        <Badge tone={here ? "brand" : "neutral"} dot>
          {here ? t("sync.role.hereBadge") : t("sync.role.thereBadge", { name })}
        </Badge>
        {!here && (
          <Button data-sy="take" variant="secondary" loading={busy} onClick={() => void take()}>
            {t("sync.role.take")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Lo que perdió frente a un cambio más reciente: por páginas, y se puede volver a poner. */
function Saved({ status, beat, onChanged }: { status: SyncStatus; beat: number; onChanged: () => void }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const [list, setList] = useState<{ total: number; items: SyncSaved[] }>();
  const [busy, setBusy] = useState<string>();
  const asked = useRef(0);
  const load = useCallback(async (at: number) => {
    const mine = ++asked.current;
    const got = await client.call("sync.saved", { limit: PAGE, offset: at * PAGE }).catch(() => undefined);
    if (got && mine === asked.current) setList(got);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: se vuelve a pedir cuando cambia la cuenta o el núcleo avisa.
  useEffect(() => {
    void load(page);
  }, [load, page, status.saved, beat]);
  const total = list?.total ?? 0;
  const last = Math.max(0, Math.ceil(total / PAGE) - 1);
  useEffect(() => {
    if (list && page > last) setPage(last);
  }, [list, page, last]);
  const name = status.peer?.name ?? "";
  const recover = async (id: string) => {
    setBusy(id);
    try {
      const { ok } = await client.call("sync.recover", { id });
      if (!ok) notify(t("sync.failed"));
      await load(page);
      onChanged();
    } catch {
      notify(t("sync.failed"));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <BackupCard name="sync-saved" icon={<Icons.History />} title={t("sync.saved.title")} hint={t("sync.saved.hint")}>
      {list && total === 0 && (
        <p className="sy-empty" data-sy="saved-empty">
          {t("sync.saved.empty")}
        </p>
      )}
      {list && total > 0 && (
        <>
          <ul className="sy-list" data-sy="saved-list">
            {list.items.map((v) => (
              <li key={v.id} className="sy-row" data-sy="saved-row">
                <span className="sy-row__kind">{t(`sync.kind.${v.kind}`)}</span>
                <span className="sy-row__text">
                  <span className="sy-row__label" title={v.label}>
                    {v.label}
                  </span>
                  <span className="sy-row__meta">
                    {v.mine ? t("sync.saved.mine") : t("sync.saved.theirs", { name })} · {shortWhen(v.lost_at)}
                  </span>
                </span>
                {v.recovered_at ? (
                  <Badge tone="brand">{t("sync.saved.recovered")}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-sy="recover"
                    loading={busy === v.id}
                    disabled={busy !== undefined}
                    leadingIcon={<Icons.RotateCcw />}
                    onClick={() => void recover(v.id)}
                  >
                    {t("sync.saved.recover")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {total > PAGE && (
            <div className="sy-pager" data-sy="pager">
              <span className="sy-pager__range">
                {t("sync.saved.range", {
                  from: formatNumber(page * PAGE + 1),
                  to: formatNumber(Math.min(total, (page + 1) * PAGE)),
                  total: formatNumber(total),
                })}
              </span>
              <IconButton
                size="sm"
                variant="ghost"
                data-sy="prev"
                label={t("sync.saved.prev")}
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                icon={<Icons.ChevronLeft />}
              />
              <IconButton
                size="sm"
                variant="ghost"
                data-sy="next"
                label={t("sync.saved.next")}
                disabled={page >= last}
                onClick={() => setPage((p) => Math.min(last, p + 1))}
                icon={<Icons.ChevronRight />}
              />
            </div>
          )}
        </>
      )}
    </BackupCard>
  );
}

/** Dejar de sincronizar, con su aviso de lo que pasa después. */
function Unpair({ status, onStatus }: { status: SyncStatus; onStatus: Set }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = status.peer?.name ?? "";
  const stop = async () => {
    setBusy(true);
    try {
      onStatus(await client.call("sync.unpair", {}));
      setOpen(false);
    } catch {
      notify(t("sync.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sy-end">
      <Button data-sy="unpair" variant="ghost" onClick={() => setOpen(true)}>
        {t("sync.unpair")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={t("sync.unpair.title", { name })}
        description={t("sync.unpair.body")}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              {t("sync.pair.cancel")}
            </Button>
            <Button data-sy="unpair-go" variant="danger" loading={busy} onClick={() => void stop()}>
              {t("sync.unpair.go")}
            </Button>
          </>
        }
      />
    </div>
  );
}
