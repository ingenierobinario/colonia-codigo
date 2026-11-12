// NAVEGADORES-1: one browser profile inside Colonia, like the browser itself: its tabs (new, close), back, forward,
// reload and the address. Its sign-ins persist in its own jar (profile nav:<id>), apart from the real browser's.
import { BrowserTabs, EmptyState, Icons } from "@colonia/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, loadTabs } from "../data/actions.ts";
import { BROWSER_NAMES, navProfile, useNavegadores } from "../data/navegadores.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { BrowserToolbar } from "../panel/BrowserToolbar.tsx";
import { BrowserViewport } from "../panel/BrowserViewport.tsx";
import { useBrowserPoppedOut } from "../panel/browserWindow.ts";
import { nav, useNav } from "../shell/nav.ts";
import "../styles/browser-panel.css";
import "../styles/webapps.css";

export function NavegadorScreen() {
  const t = useT();
  const id = useNav((s) => s.navegadorId);
  const navegador = useNavegadores((s) => s.navegadores.find((n) => n.id === id));
  const loaded = useNavegadores((s) => s.loaded);
  const profile = id ? navProfile(id) : undefined;
  const allTabs = useData((s) => s.tabs);
  const tabs = allTabs.filter((x) => x.profile === profile);
  const [picked, setPicked] = useState<string>();
  const [adding, setAdding] = useState(false);
  const active = tabs.find((x) => x.tab === picked) ?? tabs[0];
  const activeId = active?.tab;
  const poppedOut = useBrowserPoppedOut();
  const showNew = adding || !active;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new profile starts on its own first tab
  useEffect(() => {
    void loadTabs();
    setPicked(undefined);
    setAdding(false);
    // The side browser and this view share the one native page: the side panel steps aside.
    if (nav.get().panel === "browser") nav.set({ panel: null });
  }, [id]);
  useEffect(() => {
    if (activeId && !showNew && !poppedOut) window.coloniaDesktop?.showBrowserTab?.(activeId);
  }, [activeId, showNew, poppedOut]);

  if (!navegador || !profile)
    return loaded ? (
      <div className="webapp">
        <EmptyState icon={<Icons.Globe />} title={t("navegadores.gone")}>
          {t("navegadores.goneBody")}
        </EmptyState>
      </div>
    ) : null;

  return (
    <div className="webapp navegador">
      <div className="navegador__head">
        <span className="navegador__name" title={navegador.email}>
          {BROWSER_NAMES[navegador.browser]} · {navegador.name}
        </span>
        <BrowserTabs
          className="navegador__tabs"
          value={showNew ? undefined : activeId}
          onValueChange={(tab) => {
            setAdding(false);
            setPicked(tab);
          }}
          onClose={(tab) => void browserClose(tab)}
          onNew={() => setAdding(true)}
          newLabel={t("browser.newTab")}
          closeLabel={t("browser.closeTab")}
          tabs={tabs.map((x) => ({ id: x.tab, title: x.title || hostPath(x.url), url: x.url, holder: x.control.kind }))}
        />
      </div>
      <div className="navegador__bar">
        <BrowserToolbar
          forward
          key={showNew ? "new" : activeId}
          tab={showNew ? undefined : active}
          profile={profile}
          onOpened={(tab) => {
            setAdding(false);
            if (tab) setPicked(tab);
          }}
        />
      </div>
      {showNew || !activeId ? (
        <div className="navegador__empty">
          <EmptyState icon={<Icons.Globe />} title={tabs.length ? t("browser.newTab") : t("navegadores.empty")}>
            {tabs.length ? t("browser.newTabHint") : t("navegadores.emptyBody")}
          </EmptyState>
        </div>
      ) : (
        <BrowserViewport tab={activeId} />
      )}
    </div>
  );
}
