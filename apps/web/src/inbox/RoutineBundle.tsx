import type { Thread } from "@colonia/protocol";
import { Icons } from "@colonia/ui";
import { useEffect, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { routineName } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ListedChat } from "./Delegated.tsx";
import { FoldHead, useFold } from "./FoldHead.tsx";
import { SessionRow } from "./InboxViews.tsx";
import { selectionPath } from "./selectionPath.ts";
import { ThreadAvatar } from "./ThreadAvatar.tsx";

const SHOWN = 5;

/** One routine, with its executions and their delegated sessions underneath in every Inbox view. */
export function RoutineBundle({
  routineId,
  threads,
  selected,
}: {
  routineId: string;
  threads: Thread[];
  selected: string | undefined;
}) {
  const t = useT();
  const agents = useShownAgents();
  const [all, setAll] = useState(false);
  const loaded = useData((s) => s.threads);
  const path = selectionPath(loaded, selected);
  const active = threads.findIndex((th) => path.has(th.id));
  const [open, setOpen] = useFold(`routine:${routineId}`, { holdsSelected: !!selected && active >= 0 });
  useEffect(() => {
    if (selected && active >= SHOWN) setAll(true);
  }, [active, selected]);
  const latest = threads.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b));
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const shown = all ? threads : threads.slice(0, SHOWN);
  return (
    <div className="taskbundle routinebundle" data-routine={routineId}>
      <FoldHead
        open={open}
        onToggle={() => setOpen(!open)}
        className="taskbundle__task"
        label={`${t(open ? "inbox.routineBundle.close" : "inbox.routineBundle.open")}: ${routineName(latest)}`}
        unread={unread > 0}
        lead={<Icons.Clock size={16} className="taskbundle__icon" />}
        title={<span className="taskbundle__title">{routineName(latest)}</span>}
        count={
          <>
            <ThreadAvatar thread={latest} agent={agents[latest.agent_ids[0] ?? ""]} size={14} />
            {threads.length === 1
              ? t("inbox.routineBundle.runs.one")
              : t("inbox.routineBundle.runs.other", { n: threads.length })}
          </>
        }
        side={
          <>
            {unread > 0 && <span className="tree__unread">{unread}</span>}
            <span className="tree__when">{shortWhen(latest.updated_at)}</span>
          </>
        }
      />
      {open && (
        <div className="tree__sessions">
          {shown.map((thread) => (
            <ListedChat key={thread.id} thread={thread} selected={selected}>
              <SessionRow thread={thread} agent={agents[thread.agent_ids[0] ?? ""]} selected={thread.id === selected} />
            </ListedChat>
          ))}
          {threads.length > SHOWN && (
            <button type="button" className="tree__more" onClick={() => setAll(!all)}>
              {all ? t("inbox.showLess") : t("inbox.showMore", { n: threads.length - SHOWN })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
