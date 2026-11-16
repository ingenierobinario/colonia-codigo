import { Button, Input } from "@colonia/ui";
import { useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { ProblemLine } from "../channels/ProblemLine.tsx";
import { botSpec, StartButton, useTokens } from "../config/BotSection.tsx";
import { fieldSample } from "../config/botFields.ts";
import { saveChannel, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CardState } from "./CardState.tsx";

/** A bot channel connected from the setup (Discord, Slack): its token(s), Connect, and how to make the bot. */
export function BotCard({ kind, line, body }: { kind: "discord" | "slack"; line: MessageKey; body: MessageKey }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const channel = useChannels((s) => s.channels.find((c) => c.type === kind));
  const spec = botSpec(kind);
  const tokens = useTokens(kind);
  const [busy, setBusy] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const connect = async () => {
    const boss = Object.values(agents).find((a) => a.kind === "secretary");
    if (!boss) return;
    setBusy(true);
    const ok = await saveChannel(
      kind,
      { agent_id: boss.id, enabled: true, strangers: "pair", concurrency: "steer", owner_thread: "home" },
      tokens.joined,
    );
    setBusy(false);
    if (ok) {
      tokens.clear();
      notify(t("tg.tokenSaved"), "info");
    }
  };
  return (
    <div className={`wiz__engine${channel?.token_set ? " is-on" : ""}`}>
      <div className="wiz__enginehead">
        <KindTile kind={kind} size={34} />
        <span className="wiz__enginetitles">
          <b>{spec.name}</b>
          <span>{t(line)}</span>
        </span>
        <CardState
          on={Boolean(channel?.token_set) && channel?.status !== "error"}
          error={channel?.error}
          account={channel?.account}
        />
      </div>
      <p className="wiz__enginebody">{t(body)}</p>
      {channel?.token_set && <ProblemLine error={channel.error} />}
      {!channel?.token_set && (
        <>
          {tokens.specs.map((s, i) => (
            <div className="wiz__keyrow" key={s.label}>
              <Input
                type={s.plain ? "text" : "password"}
                autoComplete="off"
                aria-label={`${spec.name}: ${t(s.label)}`}
                placeholder={fieldSample(s, t)}
                value={tokens.values[i]}
                onChange={(e) => tokens.set(i, e.currentTarget.value)}
              />
              {i === tokens.specs.length - 1 && (
                <Button size="sm" loading={busy} disabled={!tokens.ok} onClick={() => void connect()}>
                  {t("setup.channels.connect")}
                </Button>
              )}
            </div>
          ))}
          <button type="button" className="wiz__hintline is-link" onClick={() => setHowTo((v) => !v)}>
            {t("setup.channels.howTo", { name: spec.name })}
          </button>
          {howTo && (
            <>
              <ol className="wiz__howto">
                {spec.steps.map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ol>
              <div>
                <StartButton kind={kind} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
