// CANALES-SENCILLOS-2: what "Add channel" offers. Every kind holds as many accounts as the owner connects, so a kind
// stays in the list once it has one: picking it again starts another account instead of opening the one there is.
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind } from "./kinds.ts";

/** Kinds that are this computer itself: there is no second account to add, picking one opens it. */
const SINGLE: readonly ChannelKind[] = ["imessage"];

export type AddChoice = {
  kind: ChannelKind /** The kind has an account already: this adds one more. */;
  another: boolean;
};

/** Every kind, in the order they are offered: those that work, then the coming ones. */
export function addChannelChoices(connected: readonly string[]): { ready: AddChoice[]; soon: AddChoice[] } {
  const all = CHANNEL_KIND_IDS.map(
    (kind): AddChoice => ({ kind, another: connected.includes(kind) && !SINGLE.includes(kind) }),
  );
  return {
    ready: all.filter((c) => !CHANNEL_KINDS[c.kind].soon),
    soon: all.filter((c) => CHANNEL_KINDS[c.kind].soon),
  };
}
