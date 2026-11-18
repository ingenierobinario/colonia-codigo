import type { Equipo } from "@colonia/protocol";
import { secureRequestKey } from "@colonia/protocol/client";
import { Button, Field, Textarea } from "@colonia/ui";
import { useRef, useState } from "react";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { keepDraft } from "../data/drafts.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

export function RemoteTask({ computer }: { computer: Equipo }) {
  const t = useT();
  const agentId = useData((s) => Object.values(s.agents).find((a) => a.kind === "secretary")?.id);
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"unavailable" | "failed">();
  const pending = useRef(false);
  const requestKey = useRef<string | undefined>(undefined);
  const available = computer.agent_access && computer.connected;
  const review = async () => {
    const text = task.trim();
    if (!available || !agentId || !text || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const from = window.location.href;
    try {
      const { equipos } = await client.call("equipos.list", {});
      const target = equipos.find((e) => e.id === computer.id && !e.local && e.agent_access && e.connected);
      if (!target) return setError("unavailable");
      requestKey.current ??= secureRequestKey();
      const chat = await createThread(
        { agentId, title: t("equipos.taskTitle", { name: target.name }) },
        requestKey.current,
      );
      keepDraft(chat.id, t("equipos.taskDraft", { name: target.name, id: target.id, task: text }));
      requestKey.current = undefined;
      if (window.location.href === from) go.thread(chat.id);
    } catch {
      setError("failed");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="eq-task">
      <Button
        variant="secondary"
        disabled={!available || !agentId || busy}
        aria-expanded={available && open}
        onClick={() => {
          setOpen(!open);
          setError(undefined);
        }}
      >
        {t("equipos.task")}
      </Button>
      {!available && (
        <p className="eq-muted">{t(!computer.agent_access ? "equipos.taskAccess" : "equipos.taskOffline")}</p>
      )}
      {available && open && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void review();
          }}
        >
          <Field label={t("equipos.taskLabel", { name: computer.name })}>
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={task}
                disabled={busy}
                onChange={(ev) => setTask(ev.currentTarget.value)}
              />
            )}
          </Field>
          <p className="eq-muted">{t("equipos.taskHint")}</p>
          <Button type="submit" disabled={!task.trim() || busy} loading={busy}>
            {t("equipos.taskReview")}
          </Button>
          {error && <p role="alert">{t(error === "unavailable" ? "equipos.taskUnavailable" : "equipos.taskFailed")}</p>}
        </form>
      )}
    </div>
  );
}
