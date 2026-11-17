import type { ChannelInfo } from "@colonia/protocol";
import { SUPER_AGENT_ID } from "@colonia/protocol/client";
import { Badge, Button, Icons, Input, Select, SettingRow, Switch, Textarea } from "@colonia/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { ProblemLine } from "../channels/ProblemLine.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { accountLabel, accountsOf, newAccountId, pickAccount } from "../data/accounts.ts";
import { type ChannelDraft, saveChannel, useChannels, watchChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { BOTS, type BotKind, botSecret, discordInvite, fieldSample, pasted, type TokenSpec } from "./botFields.ts";
import { type GuideStep, guideOf } from "./botGuide.ts";
import { botStart } from "./botStart.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";
import { PublicAddress } from "./PublicAddress.tsx";
import { isRoomsKind, RoomsSection } from "./RoomsSection.tsx";
import { Stickers } from "./StickersSection.tsx";
import { useChannelAdd } from "./useChannelAdd.ts";

export type { BotKind } from "./botFields.ts";

/** Kinds that deliver only to a webhook: their screen shows the public address to paste into the platform. */
const WEBHOOK_KINDS: readonly BotKind[] = ["teams", "line"];

/** Kinds whose single owner writes from a place only they know (an ntfy topic): that place is the owner. */
const SELF_OWNER: readonly BotKind[] = ["ntfy"];

export const isBotKind = (k: string): k is BotKind => Object.hasOwn(BOTS, k);
/** How to make a kind's bot and the token(s) it takes (the setup connects Discord and Slack with it too). */
export const botSpec = (kind: BotKind) => BOTS[kind];

/**
 * CANALES-SENCILLOS-1: the press a kind's setup starts with. It opens the platform on the page of the first step; for
 * Slack, with the app already described, so nothing is left to configure there by hand.
 */
export function StartButton({ kind, ordinal = 1 }: { kind: BotKind; ordinal?: number }) {
  const t = useT();
  const start = botStart(kind, ordinal);
  if (!start) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      leadingIcon={<Icons.ExternalLink size={14} />}
      onClick={() => window.open(start.url, "_blank", "noopener")}
    >
      {kind === "slack" ? t("sl.create") : t("bot.open", { site: start.site })}
    </Button>
  );
}

/** A bot channel (Telegram, Discord, Slack): connect it, choose who answers, approve who may write, see what went out. */
export function BotSection({ kind }: { kind: BotKind }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  useEffect(() => watchChannels(), []);
  // MULTI-CUENTA-1: every account of the kind, one shown at a time and reached by its id (never "the first of its
  // type": a second bot would have no screen, and connecting it would overwrite the first).
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  // CANALES-FACIL-1: a stored account stays on its assistant until the check of its connection is over.
  const [checkingId, setCheckingId] = useState("");
  const accounts = accountsOf(channels, kind);
  const found = pickAccount(accounts, selected);
  const channel = adding || (checkingId && found?.id === checkingId) ? undefined : found;
  // The id the next account takes: kept while its form is open, a new one for the account after it.
  const [newId, setNewId] = useState("");
  const nextId = newId || kind;
  const startAdding = () => {
    setNewId(
      newAccountId(
        kind,
        channels.map((c) => c.id),
      ),
    );
    setAdding(true);
  };
  useChannelAdd(kind, ready, startAdding);
  const name = BOTS[kind].name;
  return (
    <>
      {accounts.length > 0 && (
        <SettingRow title={t("bot.account")}>
          <Select
            label={t("bot.account")}
            value={found?.id ?? ""}
            onValueChange={(id) => {
              if (id) setSelected(id);
              setAdding(false);
            }}
            options={accounts.map((c) => ({ value: c.id, label: accountLabel(c) }))}
          />
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={startAdding}>
            {t("bot.addAccount")}
          </Button>
        </SettingRow>
      )}
      {ready &&
        (channel ? (
          <Connected key={channel.id} channel={channel} kind={kind} />
        ) : (
          <>
            <Setup
              key={nextId}
              kind={kind}
              id={nextId}
              ordinal={accounts.length + 1}
              onSaved={() => setCheckingId(nextId)}
              onConnected={() => {
                setCheckingId("");
                setSelected(nextId);
                setAdding(false);
              }}
            />
            {found && (
              <div>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            )}
          </>
        ))}
      {WEBHOOK_KINDS.includes(kind) && <PublicAddress channelId={channel?.id ?? nextId} />}
      {channel && (
        <Pairing
          channelId={channel.id}
          itsMe={{ title: t("tg.itsMe", { channel: name }), hint: t("tg.itsMeHint", { channel: name }) }}
        />
      )}
      {channel && <Notices />}
      {channel && <People channelId={channel.id} />}
      {channel && kind === "telegram" && <Stickers platform="telegram" label={name} />}
      {channel && <Deliveries channelId={channel.id} />}
    </>
  );
}

/** The token fields of a kind, as one value ("xoxb-… xapp-…" for Slack) once every field holds a valid token. */
export function useTokens(kind: BotKind, fresh = false) {
  const specs = BOTS[kind].tokens;
  // A first setup opens with what can be made up for the owner (an ntfy topic); a change of credentials opens empty.
  const [values, setValues] = useState<string[]>(() => specs.map((s) => (fresh ? (s.initial?.() ?? "") : "")));
  return {
    specs,
    values,
    // A code pasted inside the platform's whole message is kept alone.
    set: (i: number, v: string) =>
      setValues((cur) => cur.map((x, j) => (j === i && specs[i] ? pasted(specs[i], v) : x))),
    clear: () => setValues(specs.map(() => "")),
    ...botSecret(specs, values),
  };
}

function Setup({
  kind,
  id,
  ordinal,
  onSaved,
  onConnected,
}: {
  kind: BotKind;
  id: string;
  /** Which account of its kind this one will be: a second Slack app gets a name of its own. */
  ordinal: number;
  /** The channel is stored: the screen stays on the assistant while the connection is checked. */
  onSaved(): void;
  onConnected(): void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const tokens = useTokens(kind, true);
  const [agent, setAgent] = useState(secretary?.id ?? SUPER_AGENT_ID);
  const [busy, setBusy] = useState(false);
  // CANALES-FACIL-1: one step per screen, then the check of the connection.
  const guide = guideOf(kind);
  const [at, setAt] = useState(0);
  const [checking, setChecking] = useState(false);
  const saved = useChannels((s) => s.channels.find((c) => c.id === id));
  const [waited, setWaited] = useState(false);
  // A stored error from the try before is not this try's answer: the core gets a few seconds to start again.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!checking) return;
    setWaited(false);
    setSettled(false);
    const timers = [setTimeout(() => setWaited(true), 30_000), setTimeout(() => setSettled(true), 3_000)];
    return () => timers.forEach(clearTimeout);
  }, [checking]);
  const last = at >= guide.length;
  const step = guide[at];
  // A step can go on once the fields it asks for are valid (an empty optional one counts as its usual value).
  const stepOk = (s: GuideStep | undefined) =>
    !s?.fields ||
    s.fields.every((i) => {
      const spec = tokens.specs[i];
      return !spec || botSecret([spec], [tokens.values[i] ?? ""]).ok;
    });
  const field = (i: number) => {
    const spec = tokens.specs[i];
    if (!spec) return null;
    return (
      <div className="pform__field" key={spec.label}>
        <span className="pform__label">{t(spec.label)}</span>
        <TokenInput spec={spec} value={tokens.values[i] ?? ""} onChange={(v) => tokens.set(i, v)} />
        {spec.pick && !tokens.values[i] && (
          <div>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Copy size={14} />}
              onClick={() =>
                void navigator.clipboard
                  ?.readText()
                  .then((text) => tokens.set(i, text.trim()))
                  .catch(() => notify(t("guide.pasteBlocked"), "info"))
              }
            >
              {t("guide.paste")}
            </Button>
          </div>
        )}
        {tokens.values[i] && !botSecret([spec], [tokens.values[i] ?? ""]).ok && (
          <span className="pform__hint guide__bad">{t("guide.notValid")}</span>
        )}
      </div>
    );
  };
  const connect = async () => {
    setBusy(true);
    const ok = await saveChannel(
      id,
      {
        agent_id: agent,
        enabled: true,
        strangers: "pair",
        concurrency: "steer",
        owner_thread: "home",
        ...(SELF_OWNER.includes(kind) ? { self_owner: true } : {}),
      },
      tokens.joined,
    );
    setBusy(false);
    if (!ok) return;
    onSaved();
    setChecking(true);
    setAt(guide.length);
  };
  const copyText = (c: GuideStep["copy"]) => (typeof c === "object" ? (tokens.values[c.field] ?? "") : (c ?? ""));
  const start = botStart(kind, ordinal);
  const invite = kind === "discord" ? discordInvite(tokens.values[0] ?? "") : undefined;
  const fieldsBefore = guide.findIndex((s) => s.fields?.length);
  // Where "fix it" takes the owner back to: the step with the first field.
  const fixAt = fieldsBefore >= 0 ? fieldsBefore : 0;
  const status = saved?.status;
  const done = checking && status === "running";
  const failed = checking && settled && (status === "error" || (waited && status !== "running"));
  return (
    <div className="tgsetup guide">
      <div className="guide__progress" aria-hidden="true">
        {[...guide.map((s) => s.text), "final"].map((k, i) => (
          <span key={k} className={`guide__dot${i === at ? " is-on" : i < at ? " is-done" : ""}`} />
        ))}
      </div>
      {!last && step ? (
        <div className="guide__step" key={at}>
          <div className="guide__count">{t("guide.stepOf", { n: at + 1, total: guide.length + 1 })}</div>
          <p className="guide__text">{t(step.text)}</p>
          {step.open && (
            <div>
              <Button
                variant="secondary"
                leadingIcon={<Icons.ExternalLink size={14} />}
                onClick={() => {
                  const url = step.open === "start" ? start?.url : step.open?.url;
                  if (url) window.open(url, "_blank", "noopener");
                }}
              >
                {kind === "slack" && step.open === "start"
                  ? t("sl.create")
                  : t("bot.open", { site: step.open === "start" ? (start?.site ?? "") : step.open.site })}
              </Button>
            </div>
          )}
          {step.copy !== undefined && copyText(step.copy) && (
            <div className="guide__copy">
              <code>{copyText(step.copy)}</code>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Copy size={14} />}
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(copyText(step.copy))
                    .then(() => notify(t("guide.copied"), "info"))
                    .catch(() => {})
                }
              >
                {t("guide.copy")}
              </Button>
            </div>
          )}
          {step.fields?.filter((i) => !tokens.specs[i]?.advanced).map(field)}
          {step.fields?.some((i) => tokens.specs[i]?.advanced) && (
            <details className="tgsetup__more">
              <summary>{t("bot.more")}</summary>
              <div className="tgsetup__moreBody">{step.fields.filter((i) => tokens.specs[i]?.advanced).map(field)}</div>
            </details>
          )}
          {step.invite &&
            (invite ? (
              <div>
                <Button
                  variant="secondary"
                  leadingIcon={<Icons.ExternalLink size={14} />}
                  onClick={() => window.open(invite, "_blank", "noopener")}
                >
                  {t("dc.invite")}
                </Button>
              </div>
            ) : (
              <span className="pform__hint">{t("guide.inviteLater")}</span>
            ))}
          {step.see && <p className="guide__see">{t(step.see)}</p>}
        </div>
      ) : (
        <div className="guide__step">
          <div className="guide__count">{t("guide.stepOf", { n: guide.length + 1, total: guide.length + 1 })}</div>
          {!checking && (
            <>
              <p className="guide__text">{t("guide.final")}</p>
              <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: BOTS[kind].name })}>
                <AgentSelect size="sm" className="tgagent" value={agent} onChange={(a) => a && setAgent(a)} />
              </SettingRow>
              {!tokens.ok && <p className="guide__bad">{t("guide.missing")}</p>}
            </>
          )}
          {checking && !done && !failed && (
            <p className="guide__text" role="status">
              {t("guide.checking")}
            </p>
          )}
          {done && (
            <p className="guide__ok" role="status">
              <Icons.Check size={16} /> {t("guide.ok", { channel: BOTS[kind].name })}
            </p>
          )}
          {failed && (
            <div className="guide__fail" role="alert">
              <p className="guide__bad">{t("guide.failed")}</p>
              <ProblemLine error={saved?.error ?? "timed out"} />
            </div>
          )}
        </div>
      )}
      <div className="guide__nav">
        {at > 0 && !done && (
          <Button
            variant="ghost"
            onClick={() => {
              if (failed) {
                setChecking(false);
                setAt(fixAt);
              } else setAt(at - 1);
            }}
          >
            {failed ? t("guide.fix") : t("guide.back")}
          </Button>
        )}
        {!last && (
          <Button disabled={!stepOk(step)} onClick={() => setAt(at + 1)}>
            {t("guide.next")}
          </Button>
        )}
        {last && !checking && (
          <Button disabled={!tokens.ok} loading={busy} onClick={() => void connect()}>
            {t("guide.connect")}
          </Button>
        )}
        {failed && (
          <Button
            loading={busy}
            onClick={() => {
              setChecking(false);
              void connect();
            }}
          >
            {t("guide.retry")}
          </Button>
        )}
        {done && <Button onClick={onConnected}>{t("guide.finish")}</Button>}
      </div>
    </div>
  );
}

/** One field of a kind's secret: hidden as it is typed unless plain; a pasted file (JSON key) gets a text area. */
function TokenInput({
  spec,
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  spec: TokenSpec;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?(): void;
}) {
  const t = useT();
  const sample = placeholder ?? fieldSample(spec, t);
  if (spec.multiline)
    return (
      <Textarea
        aria-label={t(spec.label)}
        className="tgtoken__key"
        rows={4}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={sample}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  return (
    <Input
      aria-label={t(spec.label)}
      type={spec.plain ? "text" : "password"}
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={sample}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    />
  );
}

/** Paste new token(s): the core stores them and starts the bot again at once. */
function TokenField({
  channel,
  kind,
  onSave,
  onCancel,
}: {
  channel: ChannelInfo;
  kind: BotKind;
  onSave(token: string): Promise<boolean>;
  onCancel?(): void;
}) {
  const t = useT();
  const tokens = useTokens(kind);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!tokens.ok) return;
    setBusy(true);
    const done = await onSave(tokens.joined);
    setBusy(false);
    if (!done) return;
    tokens.clear();
    notify(t("tg.tokenSaved"), "info");
    onCancel?.();
  };
  return (
    <div className="tgtoken">
      {tokens.specs.map((spec, i) => (
        <TokenInput
          key={spec.label}
          spec={spec}
          autoFocus={Boolean(onCancel) && i === 0}
          placeholder={
            channel.token_set ? (spec.hint ? t("tg.tokenNew") : `${t("tg.tokenNew")} (${spec.placeholder})`) : undefined
          }
          value={tokens.values[i] ?? ""}
          onChange={(v) => tokens.set(i, v)}
          onEnter={() => void save()}
        />
      ))}
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      )}
      <Button size="sm" variant="secondary" disabled={!tokens.ok} loading={busy} onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </div>
  );
}

/** The stored token, masked, with "Change token"; the field shows only when asked for. */
function StoredToken({
  channel,
  kind,
  onSave,
}: {
  channel: ChannelInfo;
  kind: BotKind;
  onSave(token: string): Promise<boolean>;
}) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  if (changing) return <TokenField channel={channel} kind={kind} onSave={onSave} onCancel={() => setChanging(false)} />;
  return (
    <div className="tgtoken">
      <code className="tgtoken__hint">{channel.token_hint ?? "••••"}</code>
      <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setChanging(true)}>
        {t("tg.tokenChangeButton")}
      </Button>
    </div>
  );
}

function Connected({ channel, kind }: { channel: ChannelInfo; kind: BotKind }) {
  const t = useT();
  // A refused or missing token is fixed right where the error shows, not at the bottom of the page.
  const fixToken = channel.status === "error" || !channel.token_set;
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
    ...(channel.self_owner ? { self_owner: true } : {}),
    ...(channel.rooms ? { rooms: channel.rooms } : {}),
    closers: channel.closers,
    research: channel.research,
    hours: channel.hours,
  };
  const save = (patch: Partial<ChannelDraft>, newToken?: string) =>
    saveChannel(channel.id, { ...draft, ...patch }, newToken);
  return (
    <>
      <div className="pcard tgcard">
        <div className="pcard__top">
          <span className={`tgcard__tile${channel.status === "running" ? "" : " is-idle"}`}>
            <KindTile kind={kind} />
          </span>
          <div className="pcard__titles">
            <div className="pcard__name">{channel.account ?? channel.label}</div>
            <div className="pcard__id">{t(`tg.status.${channel.status}`)}</div>
          </div>
          <Badge tone={STATUS[channel.status]} dot>
            {channel.enabled ? t(`tg.status.${channel.status}`) : t("providers.off")}
          </Badge>
          <Switch
            size="sm"
            checked={channel.enabled}
            onCheckedChange={(on) => void save({ enabled: on })}
            label={t("providers.on")}
          />
        </div>
        <ProblemLine error={channel.error} />
        {fixToken && (
          <div className="tgcard__fix">
            <span className="tgcard__fixlabel">{t(channel.token_set ? "tg.tokenFix" : "tg.tokenMissing")}</span>
            <TokenField channel={channel} kind={kind} onSave={(token) => save({}, token)} />
          </div>
        )}
      </div>

      <Behavior channel={channel} save={save} />
      {isRoomsKind(kind) && <RoomsSection channel={channel} kind={kind} save={(rooms) => save({ rooms })} />}
      {!fixToken && (
        <SettingRow title={t("tg.token")} description={t("tg.tokenStored")}>
          <StoredToken channel={channel} kind={kind} onSave={(token) => save({}, token)} />
        </SettingRow>
      )}
      <div className="tgremove">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={() => void saveChannel(channel.id, null)}
        >
          {t("tg.remove")}
        </Button>
      </div>
    </>
  );
}
