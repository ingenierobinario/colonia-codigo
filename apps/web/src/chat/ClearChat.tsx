// LIMPIAR-CHAT-1. Clearing a chat: the agent starts from nothing (a new session, like /clear) while what was said
// stays above a "Conversation cleared" line. Asked first, with "summarize and go on" as the gentler choice.
import { Button, Dialog } from "@colonia/ui";
import { useState, useSyncExternalStore } from "react";
import { clearThread, compactThread } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";

// PULIDO-236-1. Which chat has the dialog open lives outside the component: narrowing the window swaps the chat
// for another <ChatView> (ChatWorkspace's compact branch), and a useState there was lost, closing the dialog.
let clearingId: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function setClearingId(id: string | undefined) {
  clearingId = id;
  for (const fn of listeners) fn();
}

/** Whether this chat's "Clear conversation" dialog is open, and the setter; survives a remount. */
export function useClearing(threadId: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => clearingId === threadId);
  return [open, (o) => setClearingId(o ? threadId : undefined)];
}

export function ClearChatDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<"clear" | "compact">();
  const run = async (what: "clear" | "compact") => {
    setBusy(what);
    await (what === "clear" ? clearThread(threadId) : compactThread(threadId));
    setBusy(undefined);
    onClose();
  };
  return (
    <Dialog
      open
      title={t("chat.clearTitle")}
      description={t("chat.clearBody")}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={!!busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" disabled={!!busy} loading={busy === "compact"} onClick={() => run("compact")}>
            {t("chat.clearCompact")}
          </Button>
          <Button variant="primary" disabled={!!busy} loading={busy === "clear"} onClick={() => run("clear")}>
            {t("chat.clearConfirm")}
          </Button>
        </>
      }
    />
  );
}
