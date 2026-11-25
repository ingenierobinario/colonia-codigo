import { ColoniaProvider } from "@colonia/ui";
import { type CSSProperties, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { loadThreadWhenReady } from "./data/actions.ts";
import { startLive } from "./data/live.ts";
import { loadNavegadores } from "./data/navegadores.ts";
import { isNewChat } from "./data/newChat.ts";
import { checkAccess, useGate } from "./data/pairing.ts";
import { usePrefs } from "./data/prefs.ts";
import { loadSetup, useSetup } from "./data/setup.ts";
import { loadTelemetry } from "./data/telemetry.ts";
import { loadWebApps } from "./data/webapps.ts";
import { workspacePath } from "./data/workspaceContext.ts";
import { useLanguage, useT } from "./i18n/index.ts";
import {
  AboutScreen,
  ArtifactWindow,
  BrowserPanel,
  ConnectScreen,
  HostedWelcome,
  loadShell,
  OAuthReturn,
  OfficeChat,
  PairScreen,
  preloadPinnedScreen,
  QuickChat,
  Shell,
  Wizard,
} from "./lazy.ts";
import { IS_BROWSER_WINDOW } from "./panel/browserWindow.ts";
import { nav, showsChat, useNav } from "./shell/nav.ts";

/** The page Google, X or LinkedIn sends the browser back to after the owner signs in (the core serves the panel there). */
const OAUTH_RETURN = ["/oauth/google", "/oauth/social"].includes(window.location.pathname.slice(workspacePath.length));

/** The desktop app's menu-bar window loads the panel with ?quick: only the quick chat. */
const QUICK = new URLSearchParams(window.location.search).has("quick");
const OFFICE_CHAT = new URLSearchParams(window.location.search).has("officeChat");

// Settings › Appearance › Font: swapping the sans token reaches every component, overlays included.
const MONO = { "--colonia-font-sans": "var(--colonia-font-mono)" } as CSSProperties;

/** The desktop app's first run (?connect): no Colonia is chosen yet, so nothing calls a core. */
const CONNECT = new URLSearchParams(window.location.search).has("connect") && Boolean(window.coloniaConnect);

/** One artifact in a window or tab of its own (?artifact=<id>). */
const ARTIFACT = new URLSearchParams(window.location.search).get("artifact") ?? undefined;

/** The desktop app's About window (?about): the hero with this build's version; no core either. */
const ABOUT = new URLSearchParams(window.location.search).has("about");

if (!(CONNECT || ABOUT || QUICK || ARTIFACT || IS_BROWSER_WINDOW || OAUTH_RETURN || OFFICE_CHAT))
  void loadShell().catch(() => {});

function Opening() {
  const t = useT();
  return (
    <p role="status" style={{ padding: "1rem", textAlign: "center" }}>
      {t("desktopInstall.opening")}
    </p>
  );
}

export function App() {
  if (CONNECT || ABOUT)
    return (
      <ColoniaProvider look="minimal" mode="dark" fill>
        <Suspense fallback={<Opening />}>{ABOUT ? <AboutScreen /> : <ConnectScreen />}</Suspense>
      </ColoniaProvider>
    );
  return <Main />;
}

function Main() {
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  const textSize = usePrefs((s) => s.textSize);
  const lang = useLanguage();
  const gate = useGate();
  useEffect(() => {
    void checkAccess(() => {
      if (QUICK || ARTIFACT || IS_BROWSER_WINDOW || OAUTH_RETURN) return;
      const { view } = nav.get();
      if (view !== "navegador" && view !== "webapp") return;
      // El enlace ya autorizado pide su lista y su pantalla antes de montar la barra lateral.
      void (view === "navegador" ? loadNavegadores() : loadWebApps());
      void preloadPinnedScreen(view).catch(() => {});
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    window.coloniaDesktop?.setLanguage?.(lang);
  }, [lang]);
  return (
    <ColoniaProvider
      look={look}
      mode={mode}
      fill
      style={{ ...(font === "mono" ? MONO : {}), "--colonia-text-scale": textSize / 100 } as CSSProperties}
    >
      {/* Google's return page finishes without pairing: the browser it lands in may be any. */}
      {OAUTH_RETURN && (
        <Suspense fallback={<Opening />}>
          <OAuthReturn />
        </Suspense>
      )}
      {!OAUTH_RETURN && gate === "checking" && <Opening />}
      {!OAUTH_RETURN && gate === "open" && <Panel />}
      {!OAUTH_RETURN && gate === "pair" && (
        <Suspense fallback={<Opening />}>
          <PairScreen />
        </Suspense>
      )}
    </ColoniaProvider>
  );
}

/** The app itself, once the core lets this panel in. */
function Panel() {
  const setup = useSetup((s) => s.open);
  const fresh = useSetup((s) => Boolean(s.status?.fresh && !s.status.done));
  const [hosted, setHosted] = useState(
    () =>
      !window.coloniaDesktop &&
      location.protocol === "https:" &&
      new URLSearchParams(location.hash.slice(1)).get("host") === "welcome",
  );
  // Las peticiones iniciales de la barra lateral comparten las conexiones HTTP con el chat.
  useLayoutEffect(() => {
    // ESPERAS-ARRANQUE-CHAT-1: Shell (y con él, ChatView) es un módulo descargado aparte; montarlo ya no es
    // instantáneo como con el import estático de antes. Si esperásemos a que ChatView pida su historial, el
    // chunk de Shell podría perder la carrera contra el primer bootstrap y los sondeos secundarios se le
    // adelantarían. Se pide aquí mismo, igual que ya hacía la ventana rápida con "home" aunque su módulo
    // aún se esté descargando.
    const threadId = QUICK ? "home" : showsChat(nav.get()) ? nav.get().threadId : undefined;
    const stop = threadId && !isNewChat(threadId) ? loadThreadWhenReady(threadId) : undefined;
    startLive();
    return stop;
  }, []);
  useEffect(() => {
    if (QUICK || IS_BROWSER_WINDOW || ARTIFACT || OFFICE_CHAT) return;
    void loadSetup();
    void loadTelemetry();
  }, []);
  if (OFFICE_CHAT)
    return (
      <Suspense fallback={<Opening />}>
        <OfficeChat />
      </Suspense>
    );
  if (ARTIFACT)
    return (
      <Suspense fallback={<Opening />}>
        <ArtifactWindow id={ARTIFACT} />
      </Suspense>
    );
  // The desktop app's browser window (?browser): only the browser panel.
  if (IS_BROWSER_WINDOW)
    return (
      <div className="browserwin">
        <Suspense fallback={<Opening />}>
          <BrowserPanel />
        </Suspense>
      </div>
    );
  return (
    <>
      {QUICK ? (
        <Suspense fallback={<Opening />}>
          <QuickChat />
        </Suspense>
      ) : (
        <Suspense fallback={<Opening />}>
          <Shell />
        </Suspense>
      )}
      {!QUICK && setup && (
        <Suspense fallback={null}>
          {hosted && fresh ? (
            <HostedWelcome
              onNew={() => {
                window.history.replaceState(null, "", "#view=equipos");
                setHosted(false);
              }}
            />
          ) : (
            <Wizard />
          )}
        </Suspense>
      )}
    </>
  );
}
