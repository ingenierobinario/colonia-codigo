import { Button, Dialog, Icons, Input, SegmentedControl, Skeleton, Tag } from "@colonia/ui";
import { useEffect, useState } from "react";
import { PublicAddress } from "../config/PublicAddress.tsx";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import {
  type Address,
  copyText,
  exportErrorMessage,
  exportProject,
  openTempLink,
  type ProjectExport,
  publishProject,
  readAddress,
  saveProjectFile,
  unpublishProject,
} from "../data/project-share.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SharedFlowSummary } from "./SharedFlowSummary.tsx";
import { ShareWorkFiles, WorkFileList } from "./ShareWorkFiles.tsx";
import "../styles/screens.css";
import "../styles/project-share.css";

type Mode = "export" | "publish";

const OFF: Address = {
  mode: "off",
  url_may_change: false,
  port: 0,
  tailscale: { installed: false, connected: false },
  ngrok: { installed: false },
};
/** What the dialog says when the temporary link could not open: in plain words, with the way out. */
const TEMP_ERRORS: Partial<Record<NonNullable<Address["error"]>, MessageKey>> = {
  cloudflare_download: "hooks.err.cloudflare_download",
  cloudflare_timeout: "hooks.err.cloudflare_timeout",
  cloudflare_stopped: "hooks.err.cloudflare_stopped",
  failed: "hooks.err.failed",
};

/**
 * PROYECTO-COMPARTIR-1 · Share a project with someone else who uses Colonia: as a file or text they import, or as a
 * link on this Colonia's public address. It shows what goes and what never does before anything leaves.
 */
export function ShareProjectDialog({ project, onClose }: { project: ProjectEntry; onClose(): void }) {
  return <ProjectPackageDialog key={project.id} project={project} onClose={onClose} />;
}

function ProjectPackageDialog({ project, onClose }: { project: ProjectEntry; onClose(): void }) {
  const t = useT();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("export");
  const [pkg, setPkg] = useState<ProjectExport>();
  const [error, setError] = useState<string>();
  const [path, setPath] = useState<string>();
  const [publishedFiles, setPublishedFiles] = useState<string[]>();
  /** The public address as the core has it: `null` while unknown. */
  const [addr, setAddr] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  /** ENLACE-TEMPORAL-1 · The temporary link is being opened (the first time Colonia also fetches the tool). */
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let live = true;
    const read = () =>
      void exportProject(project.id, selected).then(
        (r) => {
          if (!live) return;
          setPkg(r);
          setPath(r.path);
          setPublishedFiles(r.published_files);
        },
        (cause) => {
          if (live) setError(exportErrorMessage(cause));
        },
      );
    const timer = selected.length ? setTimeout(read, 120) : undefined;
    if (!timer) read();
    return () => {
      clearTimeout(timer);
      live = false;
    };
  }, [project.id, selected]);
  useEffect(() => {
    if (mode !== "publish") return;
    let live = true;
    const read = () => void readAddress().then((a) => live && setAddr(a ?? OFF));
    read();
    // Advanced options change the address from inside this dialog: it is read again while the tab is open.
    const timer = setInterval(read, 5_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mode]);
  const base = addr?.url && addr.mode !== "off" && !addr.error ? addr.url : "";
  const temporary = addr?.mode === "cloudflare";

  const publish = async (shared: boolean, done: "pshare.refreshed" | undefined) => {
    setBusy(true);
    if (!pkg) {
      setBusy(false);
      return;
    }
    const r = await publishProject(project.id, shared, selected, pkg.files_digest);
    setBusy(false);
    if (!r) {
      setPkg(undefined);
      setSelected((files) => [...files]);
      return;
    }
    setPath(r.path);
    setPublishedFiles(pkg.files ?? []);
    if (done) notify(t(done), "info");
  };
  const link = path && base ? `${base.replace(/\/+$/, "")}${path}` : "";
  /** One button: the free temporary link opens and the project is published on it. */
  const createTempLink = async () => {
    setOpening(true);
    const a = await openTempLink(setAddr);
    if (a?.url && !a.error) await publish(true, undefined);
    setOpening(false);
  };
  const unpublish = async () => {
    setBusy(true);
    // ENLACE-TEMPORAL-2 · The temporary link closes only when no other project is still published on it.
    const ok = await unpublishProject(project.id);
    setBusy(false);
    if (!ok) return;
    setPath(undefined);
    notify(t("pshare.unpublished"), "info");
    if (temporary) setAddr((await readAddress()) ?? OFF);
  };
  const tempError = temporary && addr?.error && !opening ? TEMP_ERRORS[addr.error] : undefined;

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={t("pshare.title")}
      description={project.name}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="pshare">
        <SegmentedControl
          label={t("pshare.how")}
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          options={[
            { value: "export", label: t("pshare.export") },
            { value: "publish", label: t("pshare.publish") },
          ]}
        />
        <div className="pshare__grid">
          <section className="pshare__card">
            <h3>{t("pshare.goes")}</h3>
            {pkg ? (
              <div className="pshare__tags" data-testid="pshare-goes">
                <Tag icon={<Icons.FileText size={12} />}>{t("pshare.goes.instructions")}</Tag>
                {pkg.agents > 0 && <Tag>{t("pshare.goes.agents", { n: pkg.agents })}</Tag>}
                {pkg.skills > 0 && <Tag>{t("pshare.goes.skills", { n: pkg.skills })}</Tag>}
                {pkg.connections > 0 && <Tag>{t("pshare.goes.connections", { n: pkg.connections })}</Tag>}
                {pkg.organization && <Tag>{t("pshare.goes.organization")}</Tag>}
              </div>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : (
              <Skeleton />
            )}
            {pkg && <SharedFlowSummary value={pkg} />}
          </section>
          <section className="pshare__card">
            <h3>{t("pshare.stays")}</h3>
            <div className="pshare__tags">
              <Tag icon={<Icons.Lock size={12} />}>{t("pshare.stays.keys")}</Tag>
              <Tag>{t("pshare.stays.chats")}</Tag>
              <Tag>{t("pshare.stays.memory")}</Tag>
              <Tag>{t("pshare.stays.tasks")}</Tag>
              <Tag>{t("pshare.stays.channels")}</Tag>
            </div>
            <p>{t("pshare.privateHint")}</p>
            <div className="pshare__actions">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icons.Lock size={14} />}
                onClick={() => {
                  onClose();
                  go.backup({ project: project.id });
                }}
              >
                {t("pshare.privateCreate")}
              </Button>
            </div>
          </section>
        </div>
        <ShareWorkFiles
          project={project.id}
          selected={selected}
          disabled={busy || opening}
          onSelect={(names) => {
            setPkg(undefined);
            setError(undefined);
            setSelected(names);
          }}
        />
        {pkg && pkg.removed > 0 && (
          // AVISO-QUITADOS-1 · Antes de que nada salga: cuánto se ha quitado, que puede quedar algo, y dónde mirar.
          <div className="pshare__warn" role="status" data-testid="pshare-removed" title={t("pshare.removedTitle")}>
            <p>
              <Icons.Lock size={14} />
              <span>{t("pshare.removed", { n: pkg.removed })}</span>
            </p>
            {pkg.removed_in.length > 0 && (
              <details>
                <summary>{t("pshare.removedWhere")}</summary>
                <ul>
                  {pkg.removed_in.map((r) => (
                    <li key={`${r.kind}:${r.name}`}>
                      {t(`pshare.in.${r.kind}`, { name: r.name })}: {r.count}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {pkg && pkg.skipped > 0 && <p className="pshare__note">{t("pshare.skipped", { n: pkg.skipped })}</p>}

        {mode === "export" ? (
          <section className="pshare__card">
            <p>{t("pshare.exportBody")}</p>
            <div className="pshare__actions">
              <Button
                disabled={!pkg}
                leadingIcon={<Icons.Download size={14} />}
                onClick={() => pkg && saveProjectFile(pkg)}
              >
                {t("pshare.save")}
              </Button>
              <Button
                variant="secondary"
                disabled={!pkg}
                title={t("pshare.copyCodeTitle")}
                leadingIcon={<Icons.Copy size={14} />}
                onClick={() => pkg && void copyText(pkg.code, "pshare.codeCopied")}
              >
                {t("pshare.copyCode")}
              </Button>
            </div>
          </section>
        ) : addr === null ? (
          <section className="pshare__card">
            <Skeleton />
          </section>
        ) : !base ? (
          <>
            <section className="pshare__card" data-testid="pshare-temp">
              <h3>{t("pshare.temp.title")}</h3>
              <p>{t("pshare.temp.body")}</p>
              {opening && (
                <p role="status" className="pshare__status">
                  <Icons.Clock size={14} />
                  <span>{t("hooks.starting")}</span>
                </p>
              )}
              {tempError && (
                <p role="alert" className="pshare__error">
                  {t(tempError)}
                </p>
              )}
              <div className="pshare__actions">
                <Button
                  disabled={!pkg}
                  loading={opening}
                  leadingIcon={<Icons.Link size={14} />}
                  onClick={() => void createTempLink()}
                >
                  {t(tempError ? "pshare.temp.retry" : "pshare.temp.create")}
                </Button>
              </div>
            </section>
            <details className="pshare__advanced">
              <summary>
                <span>{t("pshare.advanced")}</span>
                <small>{t("pshare.advancedBody")}</small>
              </summary>
              <div className="pshare__advancedBody">
                <PublicAddress />
              </div>
            </details>
          </>
        ) : link ? (
          <section className="pshare__card">
            <p>{t("pshare.published")}</p>
            <WorkFileList files={publishedFiles} state="published" />
            {temporary && (
              <p className="pshare__status" data-testid="pshare-temp-note">
                <Icons.Clock size={14} />
                <span>{t("pshare.temp.note")}</span>
              </p>
            )}
            <div className="pshare__link">
              <Input readOnly className="is-mono" aria-label={t("pshare.link")} value={link} />
              <Button leadingIcon={<Icons.Copy size={14} />} onClick={() => void copyText(link, "pshare.linkCopied")}>
                {t("pshare.copyLink")}
              </Button>
            </div>
            <div className="pshare__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !pkg}
                title={t("pshare.refreshTitle")}
                onClick={() => void publish(true, "pshare.refreshed")}
              >
                {t("pshare.refresh")}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void unpublish()}>
                {t("pshare.unpublish")}
              </Button>
            </div>
          </section>
        ) : (
          <section className="pshare__card">
            <p>{t("pshare.publishBody")}</p>
            <div className="pshare__actions">
              <Button
                disabled={!pkg}
                loading={busy}
                leadingIcon={<Icons.Link size={14} />}
                onClick={() => void publish(true, undefined)}
              >
                {t("pshare.publishNow")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
