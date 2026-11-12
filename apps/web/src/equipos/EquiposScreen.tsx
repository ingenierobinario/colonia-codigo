import "../styles/screens.css";
import "../styles/equipos.css";
import type { Equipo, EquipoAuditEntry, EquipoLocalState } from "@colonia/protocol";
import { Button, Dialog, EmptyState, Icons, SegmentedControl, Switch } from "@colonia/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { usePack, useT } from "../i18n/index.ts";

type Pair = { code: string; expires_at: string; commands: { windows: string; unix: string }; urls: string[] };

/** Consulta cada 3 s mientras la vista está abierta. */
function usePoll<T>(load: (signal: AbortSignal) => Promise<T>): [T | undefined, () => void] {
  const [value, setValue] = useState<T>();
  const now = useRef<() => void>(() => {});
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await load(abort.signal);
        if (!abort.signal.aborted) setValue(next);
      } catch {
        /* se reintenta */
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void tick(), 3000);
      }
    };
    now.current = () => {
      clearTimeout(timer);
      void tick();
    };
    void tick();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [load]);
  return [value, () => now.current()];
}

function Audit({ entries }: { entries: EquipoAuditEntry[] }) {
  const t = useT();
  const [shown, setShown] = useState(10);
  if (entries.length === 0) return <p className="eq-muted">{t("equipos.historyEmpty")}</p>;
  return (
    <>
      <ul className="eq-audit">
        {entries.slice(0, shown).map((e) => (
          <li key={`${e.n}`}>
            <time>{new Date(e.at).toLocaleString()}</time>
            <span>{e.detail}</span>
          </li>
        ))}
      </ul>
      {entries.length > shown && (
        <Button variant="ghost" size="sm" onClick={() => setShown(shown + 10)}>
          {t("equipos.more")}
        </Button>
      )}
    </>
  );
}

function AddEquipo({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [pair, setPair] = useState<Pair>();
  const [os, setOs] = useState<"windows" | "unix">(
    navigator.platform.toLowerCase().includes("win") ? "windows" : "unix",
  );
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pair) return;
    const end = Date.parse(pair.expires_at);
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pair]);
  const start = async () => {
    setError("");
    try {
      setPair(await client.call("equipos.pair_start", {}));
    } catch {
      setError(t("equipos.failed"));
    }
  };
  const cancel = async () => {
    setPair(undefined);
    await client.call("equipos.pair_cancel", {}).catch(() => {});
    onDone();
  };
  const cmd = pair ? pair.commands[os] : "";
  const step = !pair ? 1 : left === 0 ? 1 : 3;
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, "0");
  return (
    <section className="eq-card eq-card--static">
      <ol className="eq-steps">
        {(["step1", "step2", "step3", "step4"] as const).map((k, i) => (
          <li key={k} className={`eq-step${i + 1 <= step ? " eq-step--on" : ""}`}>
            <span className="eq-step__n">{i + 1}</span>
            {t(`equipos.${k}`)}
          </li>
        ))}
      </ol>
      {!pair || left === 0 ? (
        <div className="eq-row">
          <span className="eq-muted">{pair ? t("equipos.expired") : t("equipos.makeHint")}</span>
          <Button variant="primary" onClick={() => void start()}>
            <Icons.Plus /> {t("equipos.make")}
          </Button>
        </div>
      ) : (
        <>
          <SegmentedControl
            label={t("equipos.step2")}
            size="sm"
            value={os}
            onValueChange={(v) => setOs(v as "windows" | "unix")}
            options={[
              { value: "windows", label: t("equipos.windows") },
              { value: "unix", label: t("equipos.unix") },
            ]}
          />
          {pair.urls.length === 0 && <p className="eq-muted">{t("equipos.noAddress")}</p>}
          {cmd && (
            <div className="eq-cmd">
              <code>{cmd}</code>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(cmd);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Icons.Check /> : <Icons.Copy />} {copied ? t("equipos.copied") : t("equipos.copy")}
              </Button>
            </div>
          )}
          <div className="eq-row">
            <div>
              <div className="eq-muted">{t("equipos.code")}</div>
              <div className="eq-code">{pair.code}</div>
              <div className="eq-muted">{t("equipos.expires", { m: mm, s: ss })}</div>
            </div>
            <Button variant="ghost" onClick={() => void cancel()}>
              {t("equipos.cancel")}
            </Button>
          </div>
        </>
      )}
      {error && <p className="eq-muted">{error}</p>}
    </section>
  );
}

function EquipoCard({ e, refresh }: { e: Equipo; refresh: () => void }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [audit, setAudit] = useState<EquipoAuditEntry[]>([]);
  // Al cambiar de estado (conectar, usar) hay actividad nueva que mostrar.
  const stamp = `${e.in_use}${e.connected}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp vuelve a pedir la actividad
  useEffect(() => {
    void client
      .call("equipos.audit", { id: e.id })
      .then((r) => setAudit(r.entries))
      .catch(() => {});
  }, [e.id, stamp]);
  return (
    <section className="eq-card">
      <div className="eq-row">
        <span className="eq-name">
          <span className={`eq-dot${e.connected ? " eq-dot--on" : ""}`} />
          <Icons.Monitor /> {e.name}
        </span>
        <span className="eq-muted">
          {e.in_use ? t("equipos.inUse") : e.connected ? t("equipos.connected") : t("equipos.offline")}
        </span>
      </div>
      <Switch
        checked={e.agent_access}
        label={t("equipos.agents")}
        description={t("equipos.agentsHint")}
        onCheckedChange={(enabled) => void client.call("equipos.set_access", { id: e.id, enabled }).then(refresh)}
      />
      <div className="eq-muted">{t("equipos.history")}</div>
      <Audit entries={audit} />
      <div className="eq-row">
        <span />
        <Button variant="danger" onClick={() => setConfirm(true)}>
          <Icons.Trash2 /> {t("equipos.disconnect")}
        </Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("equipos.disconnectTitle")}
        description={t("equipos.disconnectBody")}
        footer={
          <Button
            variant="danger"
            onClick={() =>
              void client.call("equipos.revoke", { id: e.id }).then(() => {
                setConfirm(false);
                refresh();
              })
            }
          >
            {t("equipos.disconnect")}
          </Button>
        }
      />
    </section>
  );
}

/** Este portátil, visto desde sí mismo: aprobaciones, «permitir siempre», desbloqueo y desconexión. */
function ThisEquipo({ s, refresh }: { s: EquipoLocalState; refresh: () => void }) {
  const t = useT();
  const [pass, setPass] = useState("");
  const [bad, setBad] = useState(false);
  if (!s.paired) return s.needs_passphrase ? <p className="eq-muted">{t("equipos.needsPassword")}</p> : null;
  return (
    <section className="eq-card">
      <div className="eq-row">
        <span className="eq-name">
          <span className={`eq-dot${s.connected ? " eq-dot--on" : ""}`} />
          {t("equipos.this")}
        </span>
        <span className="eq-muted">{t("equipos.thisPaired", { url: s.principal?.url ?? "" })}</span>
      </div>
      {s.locked && (
        <div className="eq-row">
          <div>
            <strong>{t("equipos.locked")}</strong>
            <div className="eq-muted">{bad ? t("equipos.wrongPassword") : t("equipos.lockedHint")}</div>
          </div>
          <span className="eq-cmd">
            <input
              className="eq-input"
              type="password"
              aria-label={t("equipos.password")}
              placeholder={t("equipos.password")}
              value={pass}
              onChange={(ev) => setPass(ev.target.value)}
            />
            <Button
              variant="primary"
              onClick={() =>
                void client
                  .call("equipos.local_unlock", { passphrase: pass })
                  .then((r) => {
                    setBad(!r.unlocked);
                    setPass("");
                    refresh();
                  })
                  .catch(() => setBad(true))
              }
            >
              {t("equipos.unlock")}
            </Button>
          </span>
        </div>
      )}
      {s.pending.map((p) => (
        <div key={p.id} className="eq-row">
          <div>
            <strong>{t("equipos.asking")}</strong>
            <div className="eq-muted">
              {p.who}: {p.summary}
            </div>
          </div>
          <span className="eq-cmd">
            <Button
              variant="primary"
              onClick={() => void client.call("equipos.local_decide", { id: p.id, allow: true }).then(refresh)}
            >
              {t("equipos.allow")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void client.call("equipos.local_decide", { id: p.id, allow: false }).then(refresh)}
            >
              {t("equipos.deny")}
            </Button>
          </span>
        </div>
      ))}
      <Switch
        checked={s.always_allow}
        label={t("equipos.always")}
        description={t("equipos.alwaysHint")}
        onCheckedChange={(enabled) => void client.call("equipos.local_always", { enabled }).then(refresh)}
      />
      <div className="eq-muted">{t("equipos.history")}</div>
      <Audit entries={s.audit} />
      <div className="eq-row">
        <span />
        <Button variant="danger" onClick={() => void client.call("equipos.local_disconnect", {}).then(refresh)}>
          <Icons.Trash2 /> {t("equipos.disconnect")}
        </Button>
      </div>
    </section>
  );
}

function Body() {
  const t = useT();
  const loadList = useCallback((signal: AbortSignal) => client.withSignal(signal).call("equipos.list", {}), []);
  const loadLocal = useCallback((signal: AbortSignal) => client.withSignal(signal).call("equipos.local_state", {}), []);
  const [list, refreshList] = usePoll(loadList);
  const [local, refreshLocal] = usePoll(loadLocal);
  const equipos = list?.equipos ?? [];
  return (
    <section className="page equipos">
      <h1>{t("nav.equipos")}</h1>
      <p className="equipos__lead">{t("equipos.lead")}</p>
      <AddEquipo onDone={refreshList} />
      {list && equipos.length === 0 && (
        <EmptyState variant="dashed" icon={<Icons.Monitor />} title={t("equipos.none")}>
          {t("equipos.noneHint")}
        </EmptyState>
      )}
      {equipos.map((e) => (
        <EquipoCard key={e.id} e={e} refresh={refreshList} />
      ))}
      {local && <ThisEquipo s={local} refresh={refreshLocal} />}
    </section>
  );
}

export function EquiposScreen() {
  return usePack("equipos") ? <Body /> : null;
}
