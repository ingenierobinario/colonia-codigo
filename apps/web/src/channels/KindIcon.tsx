import { ChannelIcon, type MenuEntry } from "@colonia/ui";
import type { T } from "../i18n/index.ts";
import { type AddChoice, addChannelChoices } from "./addChoices.ts";
import { CHANNEL_KINDS, type ChannelKind } from "./kinds.ts";

/** A channel kind's mark where a tile goes: the app's own logo, full, with no frame around it. */
export function KindTile({ kind, size = 20 }: { kind: ChannelKind; size?: number }) {
  return (
    <span className="kindtile" style={{ width: size, height: size }}>
      <ChannelIcon channel={kind} size={Math.round(size * 0.9)} />
    </span>
  );
}

/** A channel kind's bare mark, for menus and tags. */
export function KindIcon({ kind, size = 14 }: { kind: ChannelKind; size?: number }) {
  return <ChannelIcon channel={kind} size={size} />;
}

/** "Add channel": every kind, those that work first; one that has an account already adds another (`another`). */
export function addChannelItems(
  connected: readonly string[],
  t: T,
  pick: (k: ChannelKind, another: boolean) => void,
): MenuEntry[] {
  const entry = ({ kind, another }: AddChoice): MenuEntry => ({
    label: t(CHANNEL_KINDS[kind].name),
    icon: <KindIcon kind={kind} />,
    disabled: CHANNEL_KINDS[kind].soon,
    onSelect: () => pick(kind, another),
  });
  const { ready, soon } = addChannelChoices(connected);
  return [
    ...(ready.length ? [{ type: "label" as const, label: t("channels.ready") }, ...ready.map(entry)] : []),
    ...(soon.length ? [{ type: "label" as const, label: t("common.comingSoonShort") }, ...soon.map(entry)] : []),
  ];
}
