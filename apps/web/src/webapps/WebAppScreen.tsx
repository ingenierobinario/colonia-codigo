// WEBAPP-1: a web app pinned in the sidebar, shown in the main area like a browser of its own: back, reload, its
// address and "open outside". In the desktop app the page is the real browser view; elsewhere, its screenshots.
import { EmptyState, IconButton, Icons, Skeleton } from "@colonia/ui";
import { useEffect, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserHistory } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useWebApps, webAppTab } from "../data/webapps.ts";
import { useT } from "../i18n/index.ts";
import { BrowserViewport } from "../panel/BrowserViewport.tsx";
import { useBrowserPoppedOut } from "../panel/browserWindow.ts";
import { nav, useNav } from "../shell/nav.ts";
import "../styles/browser-panel.css";
import "../styles/webapps.css";

const openOutside = (url: string) => {
  const desktop = window.coloniaDesktop;
  if (desktop?.openExternal) void desktop.openExternal(url);
  else window.open(url, "_blank", "noopener");
};

export function WebAppScreen() {
  const t = useT();
  const id = useNav((s) => s.webAppId);
  const app = useWebApps((s) => s.apps.find((a) => a.id === id));
  const loaded = useWebApps((s) => s.loaded);
  const [tabId, setTabId] = useState<string>();
  const tab = useData((s) => s.tabs.find((x) => x.tab === tabId));
  const poppedOut = useBrowserPoppedOut();

  useEffect(() => {
    setTabId(undefined);
    if (!app) return;
    // The side browser and this view share the one native page: the side panel steps aside.
    if (nav.get().panel === "browser") nav.set({ panel: null });
    let live = true;
    void webAppTab(app).then((opened) => live && setTabId(opened));
    return () => {
      live = false;
    };
  }, [app]);

  useEffect(() => {
    if (tabId && !poppedOut) window.coloniaDesktop?.showBrowserTab?.(tabId);
  }, [tabId, poppedOut]);

  if (!app)
    return loaded ? (
      <div className="webapp">
        <EmptyState icon={<Icons.Globe />} title={t("webapp.gone")}>
          {t("webapp.goneBody")}
        </EmptyState>
      </div>
    ) : null;
  const url = tab?.url ?? app.url;
  return (
    <div className="webapp">
      <div className="btoolbar webapp__bar">
        <IconButton
          size="sm"
          label={t("browser.back")}
          icon={<Icons.ArrowLeft size={15} />}
          disabled={!tabId}
          onClick={() => tabId && void browserHistory(tabId, "back")}
        />
        <IconButton
          size="sm"
          label={t("browser.reload")}
          icon={<Icons.RotateCcw size={14} />}
          disabled={!tabId}
          onClick={() => tabId && void browserHistory(tabId, "reload")}
        />
        <span className="btoolbar__url webapp__where" title={url}>
          {url.startsWith("https://") ? <Icons.Lock size={12} /> : <Icons.Globe size={12} />}
          <span className="btoolbar__urltext">{hostPath(url)}</span>
        </span>
        <IconButton
          size="sm"
          label={t("webapp.openOutside")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => openOutside(url)}
        />
      </div>
      {tabId ? <BrowserViewport tab={tabId} /> : <Skeleton className="browser__page" />}
    </div>
  );
}
