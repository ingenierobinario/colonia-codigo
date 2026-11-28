import { AgentAvatar, Button, Icons } from "@colonia/ui";
import { Suspense, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { changesDelegatedInputs, type DelegatedState, delegatedFeed } from "../data/delegated-feed.ts";
import { blobOf } from "../data/identity.ts";
import { watchEvents, watchRefresh } from "../data/live.ts";
import { isNewChat } from "../data/newChat.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { InputPart } from "../lazy.ts";
import { go } from "../shell/nav.ts";

export function DelegatedInputs({ thread }: { thread: string }) {
  const t = useT();
  const agents = useShownAgents();
  const connection = useData((state) => state.connection);
  const [state, setState] = useState<DelegatedState & { thread: string }>({ thread, inputs: [], failed: false });
  const refresh = useRef(() => {});
  useEffect(() => {
    if (connection !== "online" || isNewChat(thread)) {
      setState({ thread, inputs: [], failed: false });
      return;
    }
    const feed = delegatedFeed(
      async () => (await client.call("runs.delegated_pending", { thread })).inputs,
      (next) => setState({ ...next, thread }),
    );
    refresh.current = feed.refresh;
    const stopEvents = watchEvents((event) => {
      if (!changesDelegatedInputs(event)) return;
      if (event.type === "run.updated" || event.type === "thread.updated") feed.changed();
      else feed.refresh();
    });
    const stopRefresh = watchRefresh(feed.refresh);
    feed.refresh();
    return () => {
      feed.close();
      stopEvents();
      stopRefresh();
      refresh.current = () => {};
    };
  }, [thread, connection]);
  if (connection !== "online" || state.thread !== thread || (!state.inputs.length && !state.failed)) return null;
  return (
    <section className="delegated-inputs" aria-label={t("input.delegated")}>
      <h3>
        <Icons.Hand size={16} />
        {t("input.delegated")}
      </h3>
      {state.failed && (
        <div role="status">
          <p>{t("input.delegatedFailed")}</p>
          <Button variant="secondary" size="sm" onClick={() => refresh.current()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {state.inputs.map((request) => (
        <div className="delegated-inputs__request" key={request.part.input_id}>
          <div className="delegated-inputs__origin">
            <AgentAvatar name={request.agent_name} blob={blobOf(agents[request.agent_id])} size={26} />
            <span>
              <strong>{request.agent_name}</strong>
              <small>{request.thread_title}</small>
            </span>
            <Button size="sm" variant="ghost" onClick={() => go.subthread(request.thread_id)}>
              {t("input.openSource")}
              <Icons.ExternalLink size={14} />
            </Button>
          </div>
          <Suspense fallback={null}>
            <InputPart part={request.part} onRespond={() => refresh.current()} />
          </Suspense>
        </div>
      ))}
    </section>
  );
}
