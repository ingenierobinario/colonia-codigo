import "../styles/wizard.css";
import { Button, Icons, Input } from "@colonia/ui";
import { type FormEvent, useState } from "react";
import logo from "../assets/logo.png";
import { pairWith, pairWithOwnerKey, thisDevice } from "../data/pairing.ts";
import { useT } from "../i18n/index.ts";
import { BuildVersion } from "./BuildVersion.tsx";
import { StepHead } from "./StepsIntro.tsx";

/** The whole window while the core asks this panel for a token: a one-time code from the owner pairs it. */
export function PairScreen() {
  const t = useT();
  const [code, setCode] = useState("");
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const device = thisDevice((os) => t("pair.browser", { os }), t("pair.desktop"));
    const value = code;
    if (owner) setCode("");
    const failed = await (owner ? pairWithOwnerKey(value, device) : pairWith(value, device));
    // Paired: the page reloads with its token; until then the button stays busy.
    if (!failed) return;
    setBusy(false);
    setError(failed.why === "failed" ? t("pair.failed", { error: failed.detail ?? "" }) : t(`pair.${failed.why}`));
  };

  return (
    <div className="wiz is-pair" data-colonia-look="minimal" data-colonia-mode="dark">
      <header className="wiz__head pair__head">
        <div className="wiz__brand">
          <img src={logo} alt="" width={24} height={24} />
        </div>
      </header>
      <div className="wiz__scroll">
        <div className="wiz__grid is-single">
          <form className="wiz__main pair" onSubmit={(e) => void submit(e)}>
            <StepHead kicker="pair.kicker" title={t("pair.title")} end={t("pair.titleEnd")} green>
              {t(owner ? "pair.ownerHelp" : "pair.body")}
            </StepHead>
            <div className="wiz__field">
              <span>{t(owner ? "pair.ownerKey" : "pair.code")}</span>
              <div className="pair__row">
                <Input
                  key={owner ? "owner" : "code"}
                  type={owner ? "password" : "text"}
                  className={owner ? "wiz__name pair__ownerkey" : "wiz__name pair__code"}
                  size="lg"
                  aria-label={t(owner ? "pair.ownerKey" : "pair.code")}
                  placeholder={owner ? undefined : t("pair.placeholder")}
                  value={code}
                  maxLength={owner ? undefined : 16}
                  autoComplete={owner ? "off" : "one-time-code"}
                  autoCapitalize={owner ? "none" : "characters"}
                  spellCheck={false}
                  autoFocus
                  invalid={Boolean(error)}
                  leadingIcon={<Icons.KeyRound size={16} />}
                  onChange={(e) => setCode(e.currentTarget.value)}
                />
                <Button type="submit" size="lg" loading={busy} disabled={!code.trim()}>
                  {t("pair.submit")}
                </Button>
              </div>
              {error && (
                <span className="wiz__hintline is-error" role="alert">
                  {error}
                </span>
              )}
            </div>
            {window.isSecureContext && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setError(undefined);
                  setOwner(!owner);
                }}
              >
                {t(owner ? "pair.useCode" : "pair.useOwnerKey")}
              </Button>
            )}
          </form>
        </div>
      </div>
      <BuildVersion />
    </div>
  );
}
