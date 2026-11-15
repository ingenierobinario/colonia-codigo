import type { ChannelInfo } from "@colonia/protocol";
import { Badge, Button, Icons } from "@colonia/ui";
import { KindIcon, KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { ProblemLine } from "../channels/ProblemLine.tsx";
import { type MessageKey, useT } from "../i18n/index.ts";

/** The kinds most people already use: they show first, the rest sit folded under "More channels". */
const FEATURED: readonly ChannelKind[] = ["whatsapp", "telegram", "email", "discord", "slack"];

type State = "on" | "off" | "paused" | "starting" | "problem";

const TONE: Record<State, "brand" | "neutral" | "danger"> = {
  on: "brand",
  off: "neutral",
  paused: "neutral",
  starting: "neutral",
  problem: "danger",
};

/** A kind's state out of its accounts: a problem in one of them is what the owner has to see. */
export function kindState(accounts: readonly ChannelInfo[], selfOn = false): State {
  if (accounts.some((c) => c.enabled && (c.status === "error" || c.error))) return "problem";
  if (accounts.some((c) => c.enabled && c.status === "running") || selfOn) return "on";
  if (accounts.some((c) => c.enabled && c.status === "starting")) return "starting";
  return accounts.length ? "paused" : "off";
}

function Card({
  kind,
  accounts,
  selfOn,
  onOpen,
}: {
  kind: ChannelKind;
  accounts: readonly ChannelInfo[];
  selfOn: boolean;
  onOpen: (kind: ChannelKind) => void;
}) {
  const t = useT();
  const state = kindState(accounts, selfOn);
  const name = t(CHANNEL_KINDS[kind].name);
  const named = accounts.map((c) => c.account).filter(Boolean);
  const account = accounts.length > 1 ? t("channels.accounts", { n: accounts.length }) : named[0];
  const broken = accounts.find((c) => c.enabled && c.error);
  const action: MessageKey =
    state === "off" ? "channels.card.connect" : state === "problem" ? "channels.card.fix" : "channels.card.settings";
  return (
    <div className={`chgal__card${state === "on" ? " is-on" : ""}${state === "problem" ? " is-problem" : ""}`}>
      <div className="chgal__head">
        <KindTile kind={kind} size={32} />
        <div className="chgal__titles">
          <span className="chgal__name">{name}</span>
          {account && <span className="chgal__account">{account}</span>}
        </div>
        <Badge tone={TONE[state]} dot={state !== "off"}>
          {t(`channels.state.${state}`)}
        </Badge>
      </div>
      {state === "problem" && broken ? (
        <ProblemLine error={broken.error} />
      ) : (
        <p className="chgal__text">{t(CHANNEL_KINDS[kind].text)}</p>
      )}
      <Button
        size="sm"
        variant={state === "off" ? "primary" : "secondary"}
        aria-label={`${t(action)} ${name}`}
        onClick={() => onOpen(kind)}
      >
        {t(action)}
      </Button>
    </div>
  );
}

/** Config › Channels, "All": every kind as a card with its logo, its state and the one button that connects it here. */
export function ChannelGallery({
  channels,
  imessageOn,
  onOpen,
}: {
  channels: readonly ChannelInfo[];
  imessageOn: boolean;
  onOpen: (kind: ChannelKind) => void;
}) {
  const t = useT();
  const of = (k: ChannelKind) => channels.filter((c) => c.type === k);
  const has = (k: ChannelKind) => of(k).length > 0 || (k === "imessage" && imessageOn);
  const first = CHANNEL_KIND_IDS.filter((k) => FEATURED.includes(k) || has(k));
  const rest = CHANNEL_KIND_IDS.filter((k) => !first.includes(k));
  const card = (k: ChannelKind) => (
    <Card key={k} kind={k} accounts={of(k)} selfOn={k === "imessage" && imessageOn} onOpen={onOpen} />
  );
  return (
    <>
      <div className="chgal">{first.map(card)}</div>
      {rest.length > 0 && (
        <details className="chgal__more">
          <summary>
            <Icons.ChevronRight size={14} />
            {t("channels.more")}
            <span className="chgal__marks" aria-hidden="true">
              {rest.slice(0, 6).map((k) => (
                <KindIcon key={k} kind={k} size={14} />
              ))}
            </span>
          </summary>
          <div className="chgal">{rest.map(card)}</div>
        </details>
      )}
    </>
  );
}
