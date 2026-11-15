import { Button, Dialog, Icons, Input, SegmentedControl, Skeleton, Tag } from "@colonia/ui";
import { useEffect, useState } from "react";
import { PublicAddress } from "../config/PublicAddress.tsx";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import {
  copyText,
  exportProject,
  type ProjectExport,
  publicBase,
  publishProject,
  saveProjectFile,
} from "../data/project-share.ts";
import { useT } from "../i18n/index.ts";
import "../styles/screens.css";
import "../styles/project-share.css";

type Mode = "export" | "publish";

/**
 * PROYECTO-COMPARTIR-1 · Share a project with someone else who uses Colonia: as a file or text they import, or as a
 * link on this Colonia's public address. It shows what goes and what never does before anything leaves.
 */
export function ShareProjectDialog({ project, onClose }: { project: ProjectEntry; onClose(): void }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("export");
  const [pkg, setPkg] = useState<ProjectExport>();
  const [failed, setFailed] = useState(false);
  const [path, setPath] = useState<string>();
  /** The public address: `null` while unknown, `""` when there is none. */
  const [base, setBase] = useState<string | null>(null);
  const [address, setAddress] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void exportProject(project.id).then((r) => {
      if (!live) return;
      if (!r) return setFailed(true);
      setPkg(r);
      setPath(r.path);
    });
    return () => {
      live = false;
    };
  }, [project.id]);
  const checkAddress = async () => {
    setBase(null);
    setBase((await publicBase()) ?? "");
  };
  useEffect(() => {
    if (mode !== "publish") return;
    let live = true;
    void publicBase().then((b) => live && setBase(b ?? ""));
    return () => {
      live = false;
    };
  }, [mode]);

  const publish = async (shared: boolean, done: "pshare.refreshed" | "pshare.unpublished" | undefined) => {
    setBusy(true);
    const r = await publishProject(project.id, shared);
    setBusy(false);
    if (!r) return;
    setPath(r.path);
    if (done) notify(t(done), "info");
  };
  const link = path && base ? `${base.replace(/\/+$/, "")}${path}` : "";

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
            ) : failed ? (
              <p>{t("pshare.err.export", { error: "—" })}</p>
            ) : (
              <Skeleton />
            )}
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
          </section>
        </div>
        {pkg && pkg.removed > 0 && (
          <p className="pshare__note" title={t("pshare.removedTitle")}>
            {t("pshare.removed", { n: pkg.removed })}
          </p>
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
        ) : base === null ? (
          <section className="pshare__card">
            <Skeleton />
          </section>
        ) : base === "" ? (
          <section className="pshare__card pshare__card--empty">
            <h3>{t("pshare.noAddress")}</h3>
            <p>{t("pshare.noAddressBody")}</p>
            {address ? (
              <>
                <PublicAddress />
                <Button variant="secondary" size="sm" onClick={() => void checkAddress()}>
                  {t("pshare.checkAddress")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" leadingIcon={<Icons.Globe size={14} />} onClick={() => setAddress(true)}>
                {t("pshare.setAddress")}
              </Button>
            )}
          </section>
        ) : link ? (
          <section className="pshare__card">
            <p>{t("pshare.published")}</p>
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
                disabled={busy}
                title={t("pshare.refreshTitle")}
                onClick={() => void publish(true, "pshare.refreshed")}
              >
                {t("pshare.refresh")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void publish(false, "pshare.unpublished")}
              >
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
