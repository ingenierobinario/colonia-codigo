import type { SyncStatus } from "@colonia/protocol";
import { Button, Field, Input } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { isLocalHostingDesktop } from "./hostingOffer.ts";
import { cloudInvitation } from "./serverHosting.ts";

export function HostingPair({ onPaired }: { onPaired?: () => void } = {}) {
  const t = useT();
  const desktop = isLocalHostingDesktop(window.coloniaDesktop?.coreLocal, location.hostname);
  const [status, setStatus] = useState<SyncStatus>();
  const [joining, setJoining] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [working, setWorking] = useState(false);
  const [issue, setIssue] = useState<"read" | "connect" | "update">();
  const [copiedCode, setCopiedCode] = useState("");
  const projects = useData((state) => state.projects);
  const [selected, setSelected] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const readAgain = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const version = ++generation;
      try {
        const next = await client.call("sync.status", {});
        if (active && version === generation) setStatus(next);
      } catch {
        if (active && version === generation) setIssue("read");
      }
    };
    readAgain.current = refresh;
    void refresh();
    const unwatch = watchEvents((ev) => {
      if (ev.type === "sync.updated") void refresh();
    });
    return () => {
      active = false;
      unwatch();
    };
  }, []);
  useEffect(() => {
    if (status?.paired) onPaired?.();
  }, [status?.paired, onPaired]);
  const pairing = status?.pairing;
  const expiresAt = pairing?.expires_at;
  useEffect(() => {
    const until = expiresAt ? Date.parse(expiresAt) - Date.now() : 0;
    setExpired(until <= 0);
    if (until > 0) {
      const timer = setTimeout(() => setExpired(true), until);
      return () => clearTimeout(timer);
    }
  }, [expiresAt]);
  if (!desktop && location.protocol !== "https:") return null;
  const token = cloudInvitation(invitation);
  const act = async (f: () => Promise<void>) => {
    if (working) return;
    setIssue(undefined);
    setWorking(true);
    try {
      await f();
    } catch {
      setIssue("connect");
    } finally {
      setWorking(false);
    }
  };
  const link = () =>
    act(async () => {
      if (!token) return;
      setStatus(await client.call("sync.pair_join", { ...token, ...(selected.length ? { projects: selected } : {}) }));
      setInvitation("");
      setSelected([]);
      setJoining(false);
    });
  const start = () =>
    act(async () => {
      const next = await client.call("sync.pair_start", { initial_source: "joining_device" });
      setStatus(next);
      if (next.pairing?.initial_source !== "joining_device") setIssue("update");
    });
  const folders = projects.some((p) => p.path) && (
    <fieldset className="eq-hosting-folders">
      <legend>{t("equipos.hostingFolders")}</legend>
      {projects
        .filter((p) => p.path)
        .map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected((before) => (e.target.checked ? [...before, p.id] : before.filter((id) => id !== p.id)))
              }
            />
            <span>{p.name}</span>
          </label>
        ))}
    </fieldset>
  );
  const copyFolders = () =>
    act(async () => {
      const next = await client.call("sync.copy_projects", { projects: selected });
      setStatus(next);
      setSelected([]);
      setJoining(false);
    });
  const share = pairing?.initial_source === "joining_device" && !expired ? `${location.origin} ${pairing.code}` : "";
  return (
    <div className="eq-hosting-pair">
      {status?.paired ? (
        <>
          <strong>
            {t(
              status.role !== "secundario"
                ? "equipos.hostingPrimary"
                : status.can_copy_projects === undefined
                  ? "equipos.hostingPeer"
                  : "equipos.hostingSecondary",
            )}
          </strong>
          <p className="eq-muted">
            {t(
              status.mismatch
                ? "equipos.hostingUpdate"
                : status.connected
                  ? status.pending
                    ? "equipos.hostingPending"
                    : "equipos.hostingCurrent"
                  : "equipos.hostingReconnect",
            )}
          </p>
          {status.project_files && (
            <div role="status" aria-live="polite">
              <p>
                {t(
                  status.project_files.state === "done"
                    ? "equipos.hostingFilesDone"
                    : status.project_files.state === "working"
                      ? "equipos.hostingFilesWorking"
                      : "equipos.hostingFilesFailed",
                  {
                    completed: status.project_files.completed,
                    total: status.project_files.projects,
                    files: status.project_files.files,
                  },
                )}
              </p>
              {status.project_files.state === "failed" && (
                <>
                  <p className="eq-muted">
                    {t(
                      status.project_files.why === "source"
                        ? "equipos.hostingFileSource"
                        : status.project_files.why === "unsupported"
                          ? "equipos.hostingUpdate"
                          : "equipos.hostingFileDestination",
                    )}
                  </p>
                  <Button
                    disabled={working || !status.connected}
                    variant="secondary"
                    onClick={() => void act(async () => setStatus(await client.call("sync.copy_projects", {})))}
                  >
                    {t("equipos.hostingRetry")}
                  </Button>
                </>
              )}
            </div>
          )}
          {desktop &&
            status.can_copy_projects !== undefined &&
            folders &&
            (joining ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void copyFolders();
                }}
              >
                {folders}
                <p className="eq-muted">{t("equipos.hostingFolderHint")}</p>
                <div className="eq-row">
                  <Button type="submit" disabled={working || !status.can_copy_projects || !selected.length}>
                    {t("equipos.hostingSendFolders")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={working}
                    onClick={() => {
                      setSelected([]);
                      setJoining(false);
                    }}
                  >
                    {t("equipos.offerLater")}
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="secondary"
                disabled={!status.can_copy_projects || status.project_files?.state === "working"}
                onClick={() => setJoining(true)}
              >
                {t("equipos.hostingAddFolders")}
              </Button>
            ))}
          <Button variant="secondary" onClick={() => go.config("sync")}>
            {t("config.sync")}
          </Button>
        </>
      ) : (
        status &&
        (desktop ? (
          joining ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void link();
              }}
            >
              <Field label={t("equipos.hostingInviteLabel")} hint={t("equipos.hostingPasteHint")}>
                {(id) => (
                  <Input
                    id={id}
                    value={invitation}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setInvitation(e.target.value)}
                  />
                )}
              </Field>
              {folders}
              <p className="eq-muted">{t("equipos.hostingConsent")}</p>
              {token && <p className="eq-hosting-address">{new URL(token.address).host}</p>}
              <div className="eq-row">
                <Button type="submit" disabled={!token || working}>
                  {t("equipos.hostingAccept")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={working}
                  onClick={() => {
                    setInvitation("");
                    setSelected([]);
                    setJoining(false);
                    setIssue(undefined);
                  }}
                >
                  {t("equipos.offerLater")}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setJoining(true)}>
              {t("equipos.hostingJoin")}
            </Button>
          )
        ) : (
          <>
            <p className="eq-muted">{t("equipos.hostingFromPC")}</p>
            {share ? (
              <>
                <p className="eq-hosting-address">
                  <strong>{t("equipos.hostingInviteLabel")}</strong>
                  <br />
                  <code>{share}</code>
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(share)
                      .then(() => setCopiedCode(share))
                      .catch(() => {});
                  }}
                >
                  {t(copiedCode === share ? "equipos.hostingCopied" : "equipos.hostingCopy")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={working} onClick={() => void start()}>
                {t("equipos.hostingInvite")}
              </Button>
            )}
          </>
        ))
      )}
      {issue && (
        <p role="alert">
          {t(
            issue === "update"
              ? "equipos.hostingUpdate"
              : issue === "read"
                ? "equipos.hostingReadError"
                : "equipos.hostingJoinError",
          )}
        </p>
      )}
      {issue === "read" && (
        <Button
          variant="secondary"
          onClick={() => {
            setIssue(undefined);
            readAgain.current();
          }}
        >
          {t("equipos.hostingRetry")}
        </Button>
      )}
    </div>
  );
}
