import type { ClaudeAccountStatus } from "@colonia/protocol";
import { Badge, Button, Dialog, EngineIcon, Icons, Input } from "@colonia/ui";
import { useEffect, useState } from "react";
import { claudeCode, claudeConnect, claudeDisconnect, claudeInstall, claudeStatus } from "../data/claudeAccount.ts";
import { useT } from "../i18n/index.ts";

/** Where Claude Code is downloaded when it is not on this machine yet. */
const CLAUDE_CODE_DOWNLOAD = "https://claude.com/product/claude-code";

/**
 * CLAUDE-CUENTA-1: the Claude plan (Pro or Max), beside ChatGPT's. It signs in with Claude Code's own sign-in
 * (Anthropic keeps the plan's sign-in to Claude Code, D-043), and agents then run on it (D-185).
 */
export function ClaudePlanCard({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [s, setS] = useState<ClaudeAccountStatus>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) void claudeStatus().then(setS);
  }, [open]);
  const connected = Boolean(s?.connected);
  return (
    <div className="pcard pcard--plan pcard--claude">
      <div className="pcard__top">
        <EngineIcon engine="claude" tile size={compact ? 28 : 36} />
        <div className="pcard__titles">
          <div className="pcard__name">{t("plans.claude.name")}</div>
          <div className="pcard__plan">{t("plans.claude.kind")}</div>
        </div>
        <Badge tone={connected ? "brand" : "warning"} dot>
          {connected ? t("providers.active") : t("plans.notConnected")}
        </Badge>
      </div>
      {!(compact && !connected) && (
        <dl className="pcard__rows">
          <dt>{t("plans.account")}</dt>
          <dd>{connected ? (s?.account ?? t("plans.connected")) : "—"}</dd>
        </dl>
      )}
      <div className="pcard__actions">
        <span className="pcard__spacer" />
        <Button size="sm" variant={connected ? "secondary" : "primary"} onClick={() => setOpen(true)}>
          {t(connected ? "plans.manage" : "plans.connect")}
        </Button>
      </div>
      {open && <ClaudeLogin onClose={() => setOpen(false)} />}
    </div>
  );
}

function ClaudeLogin({ onClose }: { onClose(): void }) {
  const t = useT();
  const [s, setS] = useState<ClaudeAccountStatus>();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => {
    void claudeStatus().then(setS);
  }, []);
  // While Claude's page is open, ask every few seconds whether the owner finished there.
  useEffect(() => {
    if (!s?.pending) return;
    const iv = setInterval(async () => {
      const next = await claudeStatus();
      if (next) setS(next);
    }, 3000);
    return () => clearInterval(iv);
  }, [s?.pending]);
  const act = async (fn: () => Promise<ClaudeAccountStatus | undefined>) => {
    setBusy(true);
    const next = await fn();
    setBusy(false);
    if (next) setS(next);
    return next;
  };
  const start = async () => {
    const next = await act(claudeConnect);
    if (next?.pending) window.open(next.pending.url, "_blank", "noopener");
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("plan.claude.title")}
      description={t("plan.claude.lead")}
      footer={
        <>
          {s?.connected && (
            <Button variant="secondary" loading={busy} onClick={() => void act(claudeDisconnect)}>
              {t("plan.login.disconnect")}
            </Button>
          )}
          <Button variant={s?.connected ? "primary" : "secondary"} onClick={onClose}>
            {t(s?.connected ? "common.done" : "common.cancel")}
          </Button>
        </>
      }
    >
      <div className="planlogin">
        {!s ? null : s.connected ? (
          <p className="chatgpt__ok">
            <Icons.CircleCheck size={16} />
            {s.account ? t("plan.login.connectedAs", { account: s.account }) : t("plans.connected")}
          </p>
        ) : !s.installed ? (
          <div className="chatgpt__start">
            <p>{t("plan.claude.needsApp")}</p>
            <Button loading={busy} onClick={() => void act(claudeInstall)}>
              {t("plan.claude.install")}
            </Button>
            {busy && <p className="chatgpt__hint">{t("plan.claude.installing")}</p>}
            {s.error && <p className="chatgpt__error">{s.error}</p>}
            <p className="chatgpt__hint">{t("plan.claude.orDownload")}</p>
            <a href={CLAUDE_CODE_DOWNLOAD} target="_blank" rel="noreferrer" className="planlogin__link">
              {t("plan.claude.getApp")}
              <Icons.ExternalLink size={12} />
            </a>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void act(claudeStatus)}>
              {t("plan.claude.checkAgain")}
            </Button>
          </div>
        ) : s.pending ? (
          <div className="chatgpt__code">
            <p>{t("plan.claude.step1")}</p>
            <a href={s.pending.url} target="_blank" rel="noreferrer" className="planlogin__link">
              {t("plan.claude.openPage")}
              <Icons.ExternalLink size={12} />
            </a>
            <p>{t("plan.claude.step2")}</p>
            <form
              className="planlogin__paste"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) void act(() => claudeCode(code));
              }}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("plan.claude.codePlaceholder")}
                aria-label={t("plan.claude.codePlaceholder")}
              />
              <Button type="submit" size="sm" loading={busy} disabled={!code.trim()}>
                {t("plan.claude.finish")}
              </Button>
            </form>
            <p className="chatgpt__hint">{t("plan.login.waiting")}</p>
          </div>
        ) : (
          <div className="chatgpt__start">
            <Button loading={busy} onClick={() => void start()}>
              {t("plan.claude.start")}
            </Button>
            {s.error && <p className="chatgpt__error">{t("plan.login.failed", { error: s.error })}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
