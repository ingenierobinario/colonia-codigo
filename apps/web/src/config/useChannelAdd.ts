import { useEffect } from "react";
import type { ChannelKind } from "../channels/kinds.ts";
import { go, useNav } from "../shell/nav.ts";

/**
 * CANALES-SENCILLOS-2: "Add channel" on a kind that has an account asks for one more. The kind's screen starts it
 * here, once the accounts are read (`ready`): before that the new account would take the id of the first one.
 */
export function useChannelAdd(kind: ChannelKind, ready: boolean, start: () => void): void {
  const asked = useNav((s) => s.configChannelAdd);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `start` is a new function on every render.
  useEffect(() => {
    if (asked !== kind || !ready) return;
    start();
    go.channelAddTaken();
  }, [asked, kind, ready]);
}
