import { Button, Icons, Menu, SegmentedControl } from "@colonia/ui";
import { useEffect, useState } from "react";
import { addChannelItems, KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind, isChannelKind } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { BotSection, isBotKind } from "./BotSection.tsx";
import { ChannelGallery } from "./ChannelGallery.tsx";
import { EmailSection } from "./EmailSection.tsx";
import { IMessageSection } from "./IMessageSection.tsx";
import { ChannelSoon } from "./OtherSections.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { WhatsAppSection } from "./WhatsAppSection.tsx";

const LEAD: Partial<Record<ChannelKind, MessageKey>> = {
  telegram: "tg.lead",
  whatsapp: "wa.lead",
  discord: "dc.lead",
  slack: "sl.lead",
  matrix: "mx.lead",
  mattermost: "mm.lead",
  signal: "sg.lead",
  imessage: "im.lead",
  email: "em.lead",
  googlechat: "gc.lead",
  sms: "sms.lead",
  ntfy: "nt.lead",
  nextcloud: "nc.lead",
  irc: "irc.lead",
  twitch: "tw.lead",
  teams: "tm.lead",
  line: "ln.lead",
};

/** The tab that shows every kind as a card, next to the tabs of the connected ones. */
const ALL = "all";

/**
 * Config › Channels: "All" (a card per kind, with its logo, its state and one button), a tab per connected channel, and
 * "+" for a new one or one more account of a kind.
 */
export function ChannelsSection() {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const picked = useNav((s) => s.configChannel);
  useEffect(() => {
    void loadChannels();
  }, []);
  const imessageOn = useChannels((s) => s.imessage?.on === true);
  const connected = CHANNEL_KIND_IDS.filter(
    (k) => channels.some((c) => c.type === k) || (k === "imessage" && imessageOn),
  );
  const current = picked ?? connected[0];
  // "All" is where an owner with nothing connected lands; with channels, it is one tab away.
  const [all, setAll] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: picking a kind anywhere (the menu, a chat's card) leaves "All".
  useEffect(() => setAll(false), [picked]);
  const gallery = all || !current;
  const open = (kind: ChannelKind) => {
    setAll(false);
    go.channelConfig(kind);
  };
  // The kind being set up shows as a tab next to the connected ones until it is connected.
  const tabs = current && !connected.includes(current) ? [...connected, current] : connected;

  const add = (
    <Menu
      align="end"
      trigger={
        <Button variant="secondary" size="sm" leadingIcon={<Icons.Plus size={14} />}>
          {t("channels.add")}
        </Button>
      }
      items={addChannelItems(connected, t, go.channelConfig)}
    />
  );

  return (
    <>
      <SectionHead
        title={t("config.channels")}
        lead={!gallery && current ? t(LEAD[current] ?? CHANNEL_KINDS[current].text) : t("channels.lead")}
        actions={add}
      />
      {tabs.length > 0 && current && (
        <div className="channels__tabsrow">
          <SegmentedControl
            size="sm"
            className="channels__tabs"
            label={t("config.channels")}
            value={gallery ? ALL : current}
            onValueChange={(v) => (isChannelKind(v) ? open(v) : setAll(true))}
            options={[
              { value: ALL, label: t("channels.all"), icon: <Icons.LayoutGrid size={14} /> },
              ...tabs.map((k) => ({ value: k, label: t(CHANNEL_KINDS[k].name), icon: <KindIcon kind={k} /> })),
            ]}
          />
        </div>
      )}
      {gallery ? (
        <>
          {connected.length === 0 && (
            <div className="chgal__empty">
              <Icons.MessageCircle size={18} />
              <div>
                <b>{t("channels.empty")}</b>
                <span>{t("channels.emptyBody")}</span>
              </div>
            </div>
          )}
          <ChannelGallery channels={channels} imessageOn={imessageOn} onOpen={open} />
        </>
      ) : !current ? null : isBotKind(current) ? (
        <BotSection key={current} kind={current} />
      ) : current === "whatsapp" ? (
        <WhatsAppSection />
      ) : current === "imessage" ? (
        <IMessageSection />
      ) : current === "email" ? (
        <EmailSection />
      ) : (
        <ChannelSoon channel={current} />
      )}
    </>
  );
}
