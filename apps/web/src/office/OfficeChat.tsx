import { secureRequestKey } from "@colonia/protocol/client";
import { AgentAvatar, Button, Skeleton } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { createThread, loadThread } from "../data/actions.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AgentEditor } from "../project/team/AgentEditor.tsx";
import "./office.css";

/** Its own app context keeps this business's conversation, drafts and credentials together. */
export function OfficeChat() {
  const t = useT();
  const query = new URLSearchParams(location.search);
  const agentId = query.get("officeChat") ?? "";
  const agent = useData((s) => s.agents[agentId]);
  const ready = useData((s) => s.ready);
  const [threadId, setThreadId] = useState(query.get("thread") ?? "");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const pending = useRef<ReturnType<typeof createThread> | undefined>(undefined);
  const key = useRef(secureRequestKey());
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly restarts a failed creation with the same idempotency key.
  useEffect(() => {
    if (!agent || threadId) return;
    let active = true;
    setFailed(false);
    pending.current ??= createThread(
      { agentId: agent.id, ...(agent.project_id ? { projectId: agent.project_id } : {}) },
      key.current,
    );
    void pending.current
      .then((created) => {
        if (active) setThreadId(created.id);
      })
      .catch(() => {
        pending.current = undefined;
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [agent, threadId, retry]);
  useEffect(() => {
    if (threadId && !load) void loadThread(threadId);
  }, [threadId, load]);
  return (
    <section className="office-chat" aria-label={t("office.chat", { name: agent?.name ?? "" })}>
      {agent && (
        <header className="office-chat__agent">
          <AgentAvatar name={agent.name} blob={blobOf(agent)} size={40} />
          <strong>{agent.name}</strong>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("office.configure")}
          </Button>
        </header>
      )}
      <div className="office-chat__history">
        {ready && !agent ? (
          <p role="alert">{t("office.agentMissing")}</p>
        ) : failed || load === "error" ? (
          <div role="alert">
            <p>{t("office.chatFailed")}</p>
            <Button
              onClick={() => {
                if (threadId) void loadThread(threadId);
                else setRetry((n) => n + 1);
              }}
            >
              {t("office.retry")}
            </Button>
          </div>
        ) : thread && load === "ready" ? (
          <Transcript thread={thread} />
        ) : (
          <Skeleton height={120} />
        )}
      </div>
      {thread && agent && <ChatComposer thread={thread} agent={agent} />}
      {editing && agent && <AgentEditor agent={agent} onClose={() => setEditing(false)} />}
    </section>
  );
}
