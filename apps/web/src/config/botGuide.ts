// CANALES-FACIL-1: the setup of a bot channel as an assistant, one step per screen, written for someone who has never
// made a bot. Each step says what to do, opens the page it happens on, copies what has to be typed there, and asks for
// the field(s) that step hands back. Kinds without a guide of their own get one screen per line of their steps.
import type { MessageKey } from "../i18n/index.ts";
import { BOTS, type BotKind } from "./botFields.ts";
import { botStart } from "./botStart.ts";

export type GuideStep = {
  text: MessageKey;
  /** What the owner will see once the step is done, so they know they got it right. */
  see?: MessageKey;
  /** The page the step happens on: `start` is the kind's own first page (botStart), else a fixed one. */
  open?: "start" | { site: string; url: string };
  /** A text to type on the platform, with a Copy button: a literal, or the value of one of the kind's fields. */
  copy?: string | { field: number };
  /** The kind's fields this step asks for (by their place in BOTS[kind].tokens). */
  fields?: number[];
  /** Discord: the link that adds the bot to a server, built from the code pasted before. */
  invite?: boolean;
};

const GUIDES: Partial<Record<BotKind, GuideStep[]>> = {
  telegram: [
    { text: "guide.tg.1", see: "guide.tg.1see", open: "start" },
    { text: "guide.tg.2", see: "guide.tg.2see", copy: "/newbot" },
    { text: "guide.tg.3", fields: [0] },
  ],
  discord: [
    { text: "guide.dc.1", see: "guide.dc.1see", open: "start" },
    { text: "guide.dc.2", see: "guide.dc.2see" },
    { text: "guide.dc.3", fields: [0] },
    { text: "guide.dc.4", invite: true },
  ],
  slack: [
    { text: "guide.sl.1", see: "guide.sl.1see", open: "start" },
    { text: "guide.sl.2", fields: [0] },
    { text: "guide.sl.3", copy: "connections:write", fields: [1] },
  ],
  ntfy: [
    { text: "guide.nt.1", open: { site: "ntfy", url: "https://ntfy.sh/" } },
    { text: "guide.nt.2", copy: { field: 0 }, fields: [0, 1, 2] },
  ],
  matrix: [
    { text: "guide.mx.1", see: "guide.mx.1see", open: { site: "Element", url: "https://app.element.io/#/register" } },
    { text: "guide.mx.2", fields: [0, 1, 2] },
  ],
};

/** The assistant's screens for a kind: its own guide, or its steps one per screen, the fields on the last one. */
export function guideOf(kind: BotKind): GuideStep[] {
  const own = GUIDES[kind];
  if (own) return own;
  const { steps, tokens } = BOTS[kind];
  return steps.map((text, i) => ({
    text,
    ...(i === 0 && botStart(kind) ? { open: "start" as const } : {}),
    ...(i === steps.length - 1 ? { fields: tokens.map((_, j) => j) } : {}),
  }));
}
