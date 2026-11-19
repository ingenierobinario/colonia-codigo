import "../styles/wizard.css";
import { Button, Icons, Input, SegmentedControl } from "@colonia/ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import logo from "../assets/logo.png";
import type { SshPrompt } from "../colonia-desktop.d.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { useDesktopClass } from "../shell/desktop.ts";
import { BuildVersion } from "./BuildVersion.tsx";
import { ConnectTerminal, type TermLine } from "./ConnectTerminal.tsx";
import { CrewHero } from "./CrewHero.tsx";
import { LanguageChoice } from "./LanguageChoice.tsx";
import { ServerReady } from "./ServerReady.tsx";
import { StepHead } from "./StepsIntro.tsx";

type Via = "url" | "ssh";
type Answer =
  | { ok: true; ready?: true; linger?: string }
  | { ok: false; reason?: string; error?: string; key?: string };

/** What puts the Colonia daemon on a server that has none (install.sh, attached to every release). */
const INSTALL = "curl -fsSL https://colonia.ingenierobinario.com/install.sh | bash\ncolonia setup --headless";

/** What the desktop app answers when a client connection fails, as the owner reads it. */
const REASONS: Record<string, MessageKey> = {
  badUrl: "connect.error.badUrl",
  notReachable: "connect.error.notReachable",
  badSsh: "connect.error.badSsh",
  sshFailed: "connect.error.sshFailed",
  sshDown: "connect.error.sshDown",
  sshUnsupported: "connect.error.sshUnsupported",
  installFailed: "connect.error.installFailed",
  sshPasswordManual: "connect.error.sshPasswordManual",
  sshAuthFailed: "connect.error.sshAuthFailed",
  sshKeyRefused: "connect.error.sshKeyRefused",
};
/** What the desktop app is doing while the owner waits, as it reports each step. */
const STEPS: Record<string, MessageKey> = {
  ssh: "connect.step.ssh",
  login: "connect.step.login",
  probe: "connect.step.probe",
  install: "connect.step.install",
  connect: "connect.step.connect",
};
/** How many lines of ssh's and the server's output the terminal keeps. */
const TERM_LINES = 400;

/**
 * The desktop app's first run, before any Colonia is reached: this computer runs Colonia (server), or the app connects to one
 * elsewhere (client). Shown only inside the desktop app, which answers through window.coloniaConnect.
 */
export function ConnectScreen() {
  const t = useT();
  const desktop = useDesktopClass();
  const [step, setStep] = useState<"start" | "client">("start");
  // VOLVER-CONEXION-1: "Change connection" pressed by mistake leaves a way back to the Colonia in use.
  const [canBack, setCanBack] = useState(false);
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    // ESQUINA-OSCURA-1: this screen is always dark, whatever theme the panel left on the window controls.
    window.coloniaDesktop?.setTitleBar?.("dark");
    let live = true;
    window.coloniaConnect
      ?.previous?.()
      .then((yes) => live && setCanBack(yes === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const goBack = async () => {
    setReturning(true);
    try {
      await window.coloniaConnect?.back?.();
    } finally {
      setReturning(false);
    }
  };
  // Which of the two "here" answers is starting (its card shows it working).
  const [starting, setStarting] = useState<"new" | "move">();
  const [via, setVia] = useState<Via>("url");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The raw output behind a translated reason: on hover (title), never pasted after it.
  const [errorDetail, setErrorDetail] = useState<string>();
  // The server has no Colonia: it can be installed from here or by hand (then the command shows).
  const [noColonia, setNoColonia] = useState(false);
  const [byHand, setByHand] = useState(false);
  // Over SSH, once connecting starts, the screen is a terminal: steps, the server's output and ssh's questions.
  const [term, setTerm] = useState(false);
  const [lines, setLines] = useState<TermLine[]>([]);
  const [prompt, setPrompt] = useState<SshPrompt>();
  // This app's public key, when the owner has to add it to the server by hand.
  const [key, setKey] = useState<string>();
  // Installed on the server and reachable: said first, then Continue opens its setup.
  const [ready, setReady] = useState<{ linger?: string | undefined }>();
  const push = (line: TermLine) => setLines((l) => [...l, line].slice(-TERM_LINES));
  const answer = async (ask: () => Promise<Answer | undefined> | undefined) => {
    setBusy(true);
    setError(undefined);
    setKey(undefined);
    const c = window.coloniaConnect;
    const stops = [
      c?.onStep?.((id) => {
        const text = STEPS[id];
        if (text) push({ kind: "step", text: t(text) });
      }),
      c?.onProgress?.((text) => push({ kind: "out", text })),
      c?.onPrompt?.((p) => setPrompt(p ?? undefined)),
    ];
    let r: Answer | undefined;
    try {
      r = (await ask()) ?? { ok: false, reason: "notReachable" };
    } catch {
      r = { ok: false, reason: "notReachable" };
    } finally {
      for (const stop of stops) stop?.();
      setPrompt(undefined);
    }
    if (r?.ok && r.ready) {
      setBusy(false);
      setNoColonia(false);
      setReady({ linger: r.linger });
      return;
    }
    // Connected: the window leaves this page; until then the button stays busy.
    if (r.ok) return;
    setStarting(undefined);
    setBusy(false);
    // Not an error: the next step is to install it.
    if (r.reason === "sshNoColonia") {
      setNoColonia(true);
      return;
    }
    setNoColonia(false);
    // A target that is not user@server is fixed in the field, not in the terminal.
    if (r.reason === "badSsh") setTerm(false);
    setKey(r.key);
    const reason = r.reason && REASONS[r.reason] ? t(REASONS[r.reason] as MessageKey) : undefined;
    setError(reason ?? (r.error || r.reason));
    setErrorDetail(reason ? r.error : undefined);
  };
  const goOn = () => void answer(() => window.coloniaConnect?.ssh(address));
  const installThere = () => void answer(() => window.coloniaConnect?.installSsh(address));
  /**
   * SETUP-FACIL-1: both "here" answers start Colonia on this computer, reachable only from it (the safe default; other
   * devices are opened later in Config › Devices). "move" opens its setup on bringing their things from the other one.
   */
  const startHere = (intent: "new" | "move") => {
    if (busy) return;
    setStarting(intent);
    void answer(() =>
      intent === "move" ? window.coloniaConnect?.local("none", "move") : window.coloniaConnect?.local("none"),
    );
  };
  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim() || busy) return;
    setNoColonia(false);
    setByHand(false);
    setReady(undefined);
    if (via === "ssh") {
      setLines([]);
      setTerm(true);
    }
    void answer(() => (via === "url" ? window.coloniaConnect?.url(address) : window.coloniaConnect?.ssh(address)));
  };
  /** The owner answered ssh's question (undefined: cancelled). A password never reaches the log, only its question. */
  const reply = (value: string | undefined) => {
    if (!prompt) return;
    const asked = prompt.text.split("\n");
    const last = asked.pop() ?? "";
    for (const text of asked) push({ kind: "out", text });
    push({ kind: "said", text: value === undefined ? `${last}^C` : prompt.secret ? last : `${last}${value}` });
    window.coloniaConnect?.answer?.(prompt.id, value);
    setPrompt(undefined);
  };
  const back = () => {
    setStep("start");
    setError(undefined);
    setNoColonia(false);
    setTerm(false);
  };
  /** From the terminal back to the server field, to try again or another one. */
  const backToHost = () => {
    setTerm(false);
    setLines([]);
    setError(undefined);
    setKey(undefined);
    setNoColonia(false);
    setByHand(false);
    setReady(undefined);
  };

  return (
    <div className="wiz is-connect" data-colonia-look="minimal" data-colonia-mode="dark">
      <header className={`wiz__head${desktop}`}>
        <div className="wiz__brand">
          <img src={logo} alt="" width={24} height={24} />
          <span>Colonia</span>
        </div>
        <LanguageChoice className="connect__lang" />
      </header>
      <div className="wiz__scroll">
        <div className="wiz__grid is-single connect">
          {step === "start" && (
            <div className="connect__stage is-ready">
              <CrewHero compact />
              <div className="connect__blind">
                <div className="wiz__main connect__ask">
                  <StepHead kicker="connect.kicker" title={t("connect.title")} end={t("connect.titleEnd")} green>
                    {t("connect.body")}
                  </StepHead>
                  <div className="connect__answers">
                    <Choice
                      id="pick-server"
                      pending={t("setup.newWait")}
                      primary
                      badge={t("connect.recommended")}
                      busy={starting === "new"}
                      disabled={busy}
                      icon={<Icons.Sparkles size={18} />}
                      onClick={() => startHere("new")}
                    >
                      {t("connect.new")}
                      {t("connect.newBody")}
                    </Choice>
                    <Choice
                      id="pick-move"
                      pending={t("setup.moveWait")}
                      busy={starting === "move"}
                      disabled={busy}
                      icon={<Icons.Monitor size={18} />}
                      onClick={() => startHere("move")}
                    >
                      {t("connect.move")}
                      {t("connect.moveBody")}
                    </Choice>
                  </div>
                  {error && (
                    <span id="start-error" className="wiz__hintline is-error" role="alert" title={errorDetail}>
                      {error}
                    </span>
                  )}
                  <button
                    id="pick-client"
                    type="button"
                    className="connect__other"
                    disabled={busy}
                    onClick={() => setStep("client")}
                  >
                    <Icons.Link size={14} />
                    {t("connect.elsewhere")}
                  </button>
                  {canBack && (
                    <button
                      id="connect-back"
                      type="button"
                      className="connect__other"
                      disabled={busy || returning}
                      onClick={goBack}
                    >
                      <Icons.ArrowLeft size={14} />
                      {t("connect.back")}
                    </button>
                  )}
                  <p className="connect__later">{t("connect.body.later")}</p>
                </div>
              </div>
            </div>
          )}

          {step === "client" && term && (
            <div className="wiz__main connect__termstep">
              <ConnectTerminal target={address.trim()} lines={lines} prompt={prompt} onAnswer={reply} busy={busy}>
                {noColonia && !busy && (
                  <span id="client-nocolonia" className="wiz__hintline">
                    {t("connect.noColonia")}
                  </span>
                )}
                {noColonia && byHand && (
                  <>
                    <span className="wiz__hintline">{t("connect.byHandHint")}</span>
                    <pre className="connect__install">{INSTALL}</pre>
                  </>
                )}
                {error && (
                  <span id="client-error" className="wiz__hintline is-error" role="alert" title={errorDetail}>
                    {error}
                  </span>
                )}
                {key && (
                  <>
                    <span className="wiz__hintline">{t("connect.keyByHand")}</span>
                    <pre id="client-key" className="connect__install">
                      {key}
                    </pre>
                  </>
                )}
                {ready && !busy && <ServerReady target={address} linger={ready.linger} />}
              </ConnectTerminal>
              <div className="wiz__foot">
                {prompt ? (
                  <>
                    <span className="wiz__spacer" />
                    <Button id="term-cancel" variant="ghost" size="lg" onClick={() => reply(undefined)}>
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : (
                  !busy && (
                    <>
                      <button id="term-back" type="button" className="wiz__back" onClick={backToHost}>
                        {t("connect.backToHost")}
                      </button>
                      <span className="wiz__spacer" />
                      {ready ? (
                        <Button id="client-continue" size="lg" onClick={goOn}>
                          {t("connect.continue")}
                        </Button>
                      ) : (
                        noColonia && (
                          <>
                            {!byHand && (
                              <Button id="install-hand" variant="ghost" size="lg" onClick={() => setByHand(true)}>
                                {t("connect.installByHand")}
                              </Button>
                            )}
                            <Button id="install-there" size="lg" onClick={installThere}>
                              {t("connect.installThere")}
                            </Button>
                          </>
                        )
                      )}
                    </>
                  )
                )}
              </div>
            </div>
          )}

          {step === "client" && !term && (
            <form className="wiz__main" onSubmit={connect}>
              <StepHead
                kicker="connect.kickerClient"
                title={t("connect.clientTitle")}
                end={t("connect.clientTitleEnd")}
                green
              >
                {t("connect.clientLead")}
              </StepHead>
              <div className="connect__via">
                <SegmentedControl
                  options={[
                    { value: "url", label: t("connect.byUrl") },
                    { value: "ssh", label: "SSH" },
                  ]}
                  value={via}
                  onValueChange={(v) => {
                    setVia(v as Via);
                    setError(undefined);
                  }}
                />
              </div>
              <div className="wiz__field">
                <span>{t(via === "url" ? "connect.urlLabel" : "connect.sshLabel")}</span>
                <Input
                  id={via === "url" ? "url" : "ssh"}
                  className="wiz__name"
                  size="lg"
                  aria-label={t(via === "url" ? "connect.urlLabel" : "connect.sshLabel")}
                  placeholder={via === "url" ? "https://my-server.ts.net" : "user@server"}
                  value={address}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoFocus
                  invalid={Boolean(error)}
                  leadingIcon={via === "url" ? <Icons.Link size={16} /> : <Icons.Terminal size={16} />}
                  onChange={(e) => setAddress(e.currentTarget.value)}
                />
                <span className="wiz__hintline">{t(via === "url" ? "connect.urlHint" : "connect.sshHint")}</span>
                {error && (
                  <span id="client-error" className="wiz__hintline is-error" role="alert" title={errorDetail}>
                    {error}
                  </span>
                )}
              </div>
              <div className="wiz__foot">
                <button type="button" className="wiz__back" onClick={back}>
                  {t("setup.back")}
                </button>
                <span className="wiz__spacer" />
                <Button id="client-go" type="submit" size="lg" aria-busy={busy} disabled={busy || !address.trim()}>
                  {t(busy ? "connect.connecting" : "connect.connect")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
      <BuildVersion />
    </div>
  );
}

/** One of the first answers: an icon, a title line and a line under it; the recommended one stands out. */
function Choice(props: {
  id: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  badge?: string;
  busy?: boolean;
  disabled?: boolean;
  children: [string, string];
  pending: string;
}) {
  const [title, body] = props.children;
  return (
    <button
      id={props.id}
      type="button"
      className={`connect__answer${props.primary ? " is-primary" : ""}${props.busy ? " is-busy" : ""}`}
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      onClick={props.onClick}
    >
      <span className="connect__answericon">{props.icon}</span>
      <span className="connect__answertext">
        <span className="connect__answertitle">
          {title}
          {props.badge && <span className="connect__badge">{props.badge}</span>}
        </span>
        <span className="connect__answerbody" aria-live="polite">
          {props.busy ? props.pending : body}
        </span>
      </span>
      <Icons.ChevronRight size={18} className="connect__answergo" />
    </button>
  );
}
