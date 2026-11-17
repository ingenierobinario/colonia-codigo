import type { Result } from "@colonia/protocol";
import { randomAgentName } from "@colonia/protocol/client";
import { AgentAvatar, BLOB_NAMES, Checkbox, IconButton, Icons, Input, Skeleton, Switch } from "@colonia/ui";
import { type ReactNode, useState } from "react";
import type { V1Group, V1Groups } from "../data/setup.ts";
import { PRIVACY_URL, setUsage, useTelemetry } from "../data/telemetry.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CrewHero } from "./CrewHero.tsx";
import type { Draft, StepProps } from "./draft.ts";
import { BRING_THINGS, JUST_INSTALLED } from "./firstRun.ts";
import { LanguageChoice } from "./LanguageChoice.tsx";

/** A step's kicker, title (with its muted or green end) and text. */
export function StepHead(props: {
  kicker: MessageKey;
  title: string;
  end: string;
  green?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <div className="wiz__kicker">
        <span />
        {t(props.kicker)}
      </div>
      <h2 className="wiz__title">
        {props.title} <span className={props.green ? "is-green" : "is-muted"}>{props.end}</span>
      </h2>
      {props.children && <p className="wiz__body">{props.children}</p>}
    </>
  );
}

/** Where "I already use it on another computer" takes them: linking the two, or a backup file. */
export type BringWay = "sync" | "backup";

/** One answer card, the same as the desktop app's first question (SETUP-FACIL-1). */
function Answer(props: {
  id?: string;
  icon: ReactNode;
  title: string;
  body: ReactNode;
  primary?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      id={props.id}
      type="button"
      className={`connect__answer${props.primary ? " is-primary" : ""}`}
      onClick={props.onClick}
    >
      <span className="connect__answericon">{props.icon}</span>
      <span className="connect__answertext">
        <span className="connect__answertitle">
          {props.title}
          {props.badge && <span className="connect__badge">{props.badge}</span>}
        </span>
        <span className="connect__answerbody">{props.body}</span>
      </span>
      <Icons.ChevronRight size={18} className="connect__answergo" />
    </button>
  );
}

/**
 * The first screen: the website's hero, then one plain question (SETUP-FACIL-1). "Start" is the answer that stands
 * out; bringing the earlier version (when it is on this computer) and "I already use it on another computer" sit
 * under it. When they answered in the desktop app that they already use it elsewhere, it opens on that (MUDANZA-1).
 */
export function Welcome({
  v1,
  agent,
  onStart,
  onBring,
}: {
  v1: Result<"setup.status">["v1"];
  /** The super-agent this install has now (its name was picked at random on a fresh one). */
  agent: { name: string; blob?: string | undefined } | undefined;
  onStart: (mode: Draft["mode"]) => void;
  onBring: (way: BringWay) => void;
}) {
  const t = useT();
  // Asked once, unticked: the answer goes with the first step the owner takes.
  const ask = useTelemetry((s) => s.state?.enabled === true && s.state.usage === null);
  const [share, setShare] = useState(false);
  const [bring, setBring] = useState(BRING_THINGS);
  const begin = (mode: Draft["mode"]) => {
    if (ask) void setUsage(share);
    onStart(mode);
  };
  const pill = JUST_INSTALLED ? (
    <span className="wiz__pill crew__pill">
      {t("setup.welcome.installed")} <span className="is-muted">{t("setup.welcome.installedMuted")}</span>
      <span className="wiz__lock">
        <Icons.Check size={12} />
      </span>
    </span>
  ) : (
    <span className="wiz__pill crew__pill">
      {t("setup.welcome.pill")} <span className="is-muted">{t("setup.welcome.pillMuted")}</span>
      <span className="wiz__lock">
        <Icons.Lock size={12} />
      </span>
    </span>
  );
  const v1Body = v1
    ? v1.version
      ? t(v1.projects === 1 ? "setup.welcome.importBody.one" : "setup.welcome.importBody.other", {
          version: v1.version,
          home: v1.home,
          projects: v1.projects,
        })
      : t(v1.projects === 1 ? "setup.welcome.importNoVersion.one" : "setup.welcome.importNoVersion.other", {
          home: v1.home,
          projects: v1.projects,
        })
    : "";
  return (
    <div className="wiz__welcome crew__stage">
      <CrewHero pill={pill} />
      <div className="wiz__welcomenext">
        <LanguageChoice className="wiz__welcomelang" />
        {bring ? (
          <div className="wiz__ask">
            <h2 className="wiz__question">{t("setup.bring.title")}</h2>
            <p className="wiz__askbody">{t("setup.bring.body")}</p>
            <div className="connect__answers">
              <Answer
                id="bring-sync"
                primary
                icon={<Icons.ArrowRightLeft size={18} />}
                title={t("setup.bring.sync")}
                body={t("setup.bring.syncBody")}
                onClick={() => onBring("sync")}
              />
              <Answer
                id="bring-backup"
                icon={<Icons.ArchiveRestore size={18} />}
                title={t("setup.bring.backup")}
                body={t("setup.bring.backupBody")}
                onClick={() => onBring("backup")}
              />
            </div>
            <div className="wiz__asklinks">
              <button type="button" className="connect__other" onClick={() => setBring(false)}>
                {t("setup.bring.back")}
              </button>
              <button type="button" className="connect__other" onClick={() => begin("new")}>
                {t("setup.bring.fresh")}
              </button>
            </div>
          </div>
        ) : (
          <div className="wiz__ask">
            <h2 className="wiz__question">{t("setup.welcome.question")}</h2>
            <div className="connect__answers">
              <Answer
                id="welcome-start"
                primary
                badge={t("connect.recommended")}
                icon={<Icons.Sparkles size={18} />}
                title={t("setup.welcome.new")}
                body={t("setup.welcome.newBody")}
                onClick={() => begin("new")}
              />
              {v1 && (
                <Answer
                  id="welcome-import"
                  icon={<Icons.Download size={18} />}
                  title={t("setup.welcome.import")}
                  body={v1Body}
                  onClick={() => begin("import")}
                />
              )}
              <Answer
                id="welcome-bring"
                icon={<Icons.Monitor size={18} />}
                title={t("setup.welcome.bring")}
                body={t("setup.welcome.bringBody")}
                onClick={() => setBring(true)}
              />
            </div>
          </div>
        )}
        {ask && (
          <div className="wiz__share">
            <Checkbox
              checked={share}
              onCheckedChange={setShare}
              label={t("telemetry.check")}
              description={
                <>
                  {t("telemetry.checkHint")}{" "}
                  <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                    {t("telemetry.whatIsSent")}
                  </a>
                </>
              }
            />
          </div>
        )}
        <span className="wiz__waiting">
          <AgentAvatar
            name={v1?.agent_name ?? agent?.name ?? "crew"}
            blob={v1?.agent_blob ?? agent?.blob ?? "ovni"}
            size={24}
            animated={false}
          />
          <b>{v1?.agent_name ?? agent?.name}</b>
          <span className="is-mono">{t("setup.welcome.waiting")}</span>
          <span className="wiz__dots">•••</span>
        </span>
      </div>
    </div>
  );
}

export const GROUP: Record<V1Group, { label: MessageKey; body: MessageKey; icon: typeof Icons.Bot }> = {
  projects: { label: "setup.v1.projects", body: "setup.v1.projectsBody", icon: Icons.Folder },
  skills: { label: "setup.v1.skills", body: "setup.v1.skillsBody", icon: Icons.Sparkles },
  keys: { label: "setup.v1.keys", body: "setup.v1.keysBody", icon: Icons.KeyRound },
  vars: { label: "setup.v1.vars", body: "setup.v1.varsBody", icon: Icons.Lock },
  mcps: { label: "setup.v1.mcps", body: "setup.v1.mcpsBody", icon: Icons.Plug },
  memory: { label: "setup.v1.memory", body: "setup.v1.memoryBody", icon: Icons.Brain },
  chats: { label: "setup.v1.chats", body: "setup.v1.chatsBody", icon: Icons.MessageCircle },
  identity: { label: "setup.v1.identity", body: "setup.v1.identityBody", icon: Icons.User },
  embeddings: { label: "setup.v1.embeddings", body: "setup.v1.embeddingsBody", icon: Icons.Search },
  services: { label: "setup.v1.services", body: "setup.v1.servicesBody", icon: Icons.Image },
  channels: { label: "setup.v1.channels", body: "setup.v1.channelsBody", icon: Icons.Send },
  tasks: { label: "setup.v1.tasks", body: "setup.v1.tasksBody", icon: Icons.ListChecks },
  commitments: { label: "setup.v1.commitments", body: "setup.v1.commitmentsBody", icon: Icons.Calendar },
  routines: { label: "setup.v1.routines", body: "setup.v1.routinesBody", icon: Icons.Clock },
};

/** What v1 has, one row per part, each on unless the owner turns it off. */
export function ImportStep({ home, scan, draft: d, set }: StepProps & { home: string; scan: V1Groups | undefined }) {
  const t = useT();
  const count = (g: V1Groups[number]) =>
    g.id === "projects"
      ? t("setup.v1.projectsCount", { n: g.count, agents: g.detail ?? "0" })
      : g.id === "chats"
        ? t("setup.v1.chatsCount", { n: g.count, messages: g.detail ?? "0" })
        : g.id === "embeddings" || g.id === "identity"
          ? (g.detail ?? "—")
          : g.id === "channels"
            ? g.count
              ? "Telegram"
              : "—"
            : g.count.toLocaleString();
  return (
    <>
      <StepHead kicker="setup.import.kicker" title={t("setup.import.title")} end={t("setup.import.titleMuted")}>
        {t("setup.import.body", { home })}
      </StepHead>
      {!scan ? (
        <Skeleton height={320} />
      ) : (
        <div className="wiz__card wiz__rows">
          {scan.map((g) => {
            const G = GROUP[g.id];
            const empty = g.count === 0;
            return (
              <div key={g.id} className={`wiz__row${empty ? " is-empty" : ""}`}>
                <span className="wiz__rowicon">
                  <G.icon size={14} />
                </span>
                <span className="wiz__rowmain">
                  <span className="wiz__rowname">
                    {t(G.label)} <span className="is-muted">{count(g)}</span>
                  </span>
                  <span className="wiz__rowbody">{t(G.body)}</span>
                </span>
                <Switch
                  size="sm"
                  aria-label={t(G.label)}
                  disabled={empty}
                  checked={!empty && d.importOn[g.id] !== false}
                  onCheckedChange={(on) => set({ importOn: { ...d.importOn, [g.id]: on } })}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The super-agent's name and face. */
export function AgentStep({ draft: d, set }: StepProps) {
  const t = useT();
  return (
    <>
      <StepHead kicker="setup.agent.kicker" title={t("setup.agent.title")} end={t("setup.agent.titleMuted")}>
        {t("setup.agent.body")}
      </StepHead>
      <div className="wiz__field">
        <span>{t("setup.agent.name")}</span>
        <Input
          className="wiz__name"
          aria-label={t("setup.agent.name")}
          placeholder={t("setup.agent.namePlaceholder")}
          value={d.name}
          maxLength={80}
          onChange={(e) => set({ name: e.currentTarget.value })}
          trailing={
            <IconButton
              size="sm"
              label={t("setup.agent.randomName")}
              icon={<Icons.Dices size={16} />}
              onClick={() => set({ name: randomAgentName(d.name.trim()) })}
            />
          }
        />
      </div>
      <div className="wiz__field">
        <span>{t("setup.agent.blobs", { n: BLOB_NAMES.length })}</span>
        <div className="wiz__blobs">
          {BLOB_NAMES.map((b) => (
            <button
              key={b}
              type="button"
              aria-label={b}
              aria-pressed={d.blob === b}
              className={`wiz__blob${d.blob === b ? " is-on" : ""}`}
              onClick={() => set({ blob: b })}
            >
              <AgentAvatar name={b} blob={b} size={36} animated={false} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
