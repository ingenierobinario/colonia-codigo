import type { SyncStatus } from "@colonia/protocol";
import { useId, useState } from "react";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";
import "../styles/folder-sync.css";

type Entry = NonNullable<SyncStatus["folder_sync"]>["projects"][number];

function description(entry?: Entry): MessageKey {
  if (entry?.state === "failed") return "equipos.folderSyncFailed";
  if (entry?.remote && !entry.local) return "equipos.folderSyncRequested";
  if (!entry?.local) return "equipos.folderSyncStopped";
  if (entry.state === "offline") return "equipos.folderSyncOffline";
  if (!entry.remote) return "equipos.folderSyncWaiting";
  if (entry.state === "current") return "equipos.folderSyncCurrent";
  return "equipos.folderSyncBusy";
}

export function FolderSync({ status, onStatus }: { status: SyncStatus; onStatus: (next: SyncStatus) => void }) {
  const ready = usePack("equipos");
  const t = useT();
  const projects = useData((s) => s.projects);
  const [pending, setPending] = useState<{ project: string; enabled: boolean }>();
  const [error, setError] = useState(false);
  const prefix = useId();
  const sync = status.folder_sync;
  if (!ready || !sync) return null;
  const byProject = new Map(sync.projects.map((entry) => [entry.id, entry]));
  const rows = projects.filter((project) => project.path || byProject.has(project.id));
  if (!rows.length) return null;
  async function toggle(project: string, enabled: boolean) {
    if (pending) return;
    setPending({ project, enabled });
    setError(false);
    try {
      onStatus(await client.call("sync.set_folder_sync", { project, enabled }));
    } catch {
      setError(true);
    } finally {
      setPending(undefined);
    }
  }
  return (
    <details className="folder-sync" aria-label={t("equipos.folderSyncTitle")}>
      <summary>{t("equipos.folderSyncTitle")}</summary>
      <p>{t("equipos.folderSyncHint")}</p>
      {sync.supported === false && <p>{t("equipos.hostingUpdate")}</p>}
      <ul>
        {rows.map((project) => {
          const entry = byProject.get(project.id);
          const hasPath =
            Boolean(project.path) &&
            project.registered !== false &&
            project.present !== false &&
            !project.unreadable &&
            !status.folders?.some((p) => p.id === project.id);
          const hint = prefix + project.id;
          return (
            <li key={project.id}>
              <label>
                <input
                  type="checkbox"
                  checked={pending?.project === project.id ? pending.enabled : (entry?.local ?? false)}
                  aria-describedby={hint}
                  disabled={pending !== undefined || (!entry?.local && (!hasPath || sync.supported === false))}
                  onChange={(event) => void toggle(project.id, event.currentTarget.checked)}
                />
                <span>{project.name}</span>
              </label>
              <div id={hint} className="folder-sync__status">
                {t(
                  pending?.project === project.id
                    ? "equipos.folderSyncSaving"
                    : !hasPath && !entry?.local
                      ? "equipos.folderSyncMissing"
                      : description(entry),
                )}
                {Boolean(entry?.conflicts) && (
                  <p>{t("equipos.folderSyncConflicts", { count: entry?.conflicts ?? 0 })}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert">{t("equipos.folderSyncError")}</p>}
    </details>
  );
}
