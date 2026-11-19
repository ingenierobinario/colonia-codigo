import type { Autonomy } from "@colonia/protocol";
import { Button, Dialog, Icons, Tooltip } from "@colonia/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { updateBase, updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

const PREVIOUS = "colonia.noAsk.previous.";

/** The mode the project had before the switch, so turning it off gives it back (null: the default). */
function remember(key: string, mode: Autonomy | undefined): void {
  try {
    localStorage.setItem(PREVIOUS + key, mode ?? "");
  } catch {}
}
function recall(key: string): Autonomy | null {
  try {
    const v = localStorage.getItem(PREVIOUS + key);
    localStorage.removeItem(PREVIOUS + key);
    return v && v !== "total" ? (v as Autonomy) : null;
  } catch {
    return null;
  }
}

/**
 * "Without asking" (DECISIONS.md#d-193): puts the chat's project on Total, over its agents' own modes, and back to the
 * mode it had. Turning it on asks once; while on it stays marked in the header.
 */
export function NoAskSwitch({ projectId, compact }: { projectId: string | undefined; compact: boolean }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const base = useData((s) => s.base);
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (projectId && !project) return null;
  const mode = project ? project.autonomy : base.autonomy;
  const on = mode === "total";
  const key = projectId ?? "base";
  const name = projectName(projects, projectId);

  const set = async (autonomy: Autonomy | null) => {
    setBusy(true);
    const done = projectId ? !!(await updateProject({ project: projectId, autonomy })) : await updateBase({ autonomy });
    setBusy(false);
    return done;
  };
  const turnOn = async () => {
    remember(key, mode);
    if (await set("total")) setConfirming(false);
  };
  const label = on ? t("chat.noAskOn") : t("chat.noAsk");
  return (
    <>
      <Tooltip content={on ? t("chat.noAskHint", { project: name }) : t("chat.noAskOffHint", { project: name })}>
        <button
          type="button"
          className={on ? "chat__noask is-on" : "chat__noask"}
          aria-pressed={on}
          aria-label={label}
          disabled={busy}
          data-testid="no-ask-switch"
          onClick={() => (on ? void set(recall(key)) : setConfirming(true))}
        >
          {on ? <Icons.ShieldAlert size={13} /> : <Icons.Zap size={13} />}
          {!compact && <span>{label}</span>}
        </button>
      </Tooltip>
      {confirming && (
        <Dialog
          open
          size="sm"
          onOpenChange={(o) => !o && setConfirming(false)}
          title={t("chat.noAskConfirmTitle")}
          description={t("chat.noAskConfirmBody", { project: name })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void turnOn()}>
                {t("chat.noAskConfirm")}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
