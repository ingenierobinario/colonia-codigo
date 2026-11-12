// LIMPIAR-CHAT-1. Clearing a chat: the agent starts from nothing (a new session, like /clear) while what was said
// stays above a "Conversation cleared" line. Asked first, with "summarize and go on" as the gentler choice.
import { Button, Dialog } from "@colonia/ui";
import { useState } from "react";
import { clearThread, compactThread } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";

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
