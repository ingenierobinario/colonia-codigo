// NAVEGADORES-1: one browser profile inside Colonia, like the browser itself: its tabs (new, close), back, forward,
// reload and the address. Its sign-ins persist in its own jar (profile nav:<id>), apart from the real browser's.
import { BrowserTabs, EmptyState, Icons } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { hostPath } from "../common/format.ts";
import { browserClose, browserNavigate, browserOpen, loadTabs } from "../data/actions.ts";
import { BROWSER_NAMES, navProfile, useNavegadores } from "../data/navegadores.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { BrowserToolbar } from "../panel/BrowserToolbar.tsx";
import { BrowserViewport } from "../panel/BrowserViewport.tsx";
import { useBrowserPoppedOut } from "../panel/browserWindow.ts";
import { nav, useNav } from "../shell/nav.ts";
import "../styles/browser-panel.css";
import "../styles/webapps.css";
import { BookmarksBar, useBookmarkBar } from "./BookmarksBar.tsx";
import { activeOf, adopted, afterClose, blankId, isBlank } from "./tabstrip.ts";

export function NavegadorScreen() {
  const t = useT();
  const id = useNav((s) => s.navegadorId);
  const navegador = useNavegadores((s) => s.navegadores.find((n) => n.id === id));
  const loaded = useNavegadores((s) => s.loaded);
  const profile = id ? navProfile(id) : undefined;
  const allTabs = useData((s) => s.tabs);
  const tabs = allTabs.filter((x) => x.profile === profile);
  const [picked, setPicked] = useState<string>();
  // NAVFIX-1: las pestañas nuevas aún vacías son pestañas de la tira (tabstrip.ts): «+» abre todas las que se quieran.
  const [blanks, setBlanks] = useState<string[]>([]);
  const realIds = tabs.map((x) => x.tab);
  const shownId = activeOf(realIds, blanks, picked);
  const active = tabs.find((x) => x.tab === shownId);
  const activeId = active?.tab;
  const poppedOut = useBrowserPoppedOut();
  const blank = isBlank(shownId) ? shownId : undefined;
  const bar = useBookmarkBar(id);
  // La pestaña vacía desde la que se está abriendo una página, y las reales que había al empezar.
  const opening = useRef<{ blank: string | undefined; known: string[] }>(undefined);
  const dropBlank = (b: string | undefined) => b && setBlanks((all) => all.filter((x) => x !== b));
  const startOpening = () => {
    opening.current = { blank, known: realIds };
  };
  const opened = (from: string | undefined, tab: string | undefined) => {
    if (opening.current?.blank === from) opening.current = undefined;
    // Si no se pudo abrir (ya se avisó), la pestaña vacía sigue ahí para volver a intentarlo.
    if (!tab) return;
    dropBlank(from);
    setPicked(tab);
  };
  // NAVEGADORES-2: un marcador se abre en la pestaña a la vista; en una vacía (o sin ninguna), en una nueva del perfil.
  const openBookmark = async (url: string) => {
    if (!profile) return;
    if (activeId) return void browserNavigate(activeId, url);
    startOpening();
    opened(blank, await browserOpen(url, profile));
  };
  const close = (tab: string) => {
    setPicked(afterClose([...realIds, ...blanks], tab, shownId));
    if (isBlank(tab)) dropBlank(tab);
    else void browserClose(tab);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new profile starts on its own first tab
  useEffect(() => {
    void loadTabs();
    setPicked(undefined);
    setBlanks([]);
    opening.current = undefined;
    // The side browser and this view share the one native page: the side panel steps aside.
    if (nav.get().panel === "browser") nav.set({ panel: null });
  }, [id]);
  // NAVFIX-1: el navegador anuncia la pestaña en cuanto existe, antes de que la página cargue: la vista pasa a ella
  // ya, en vez de quedarse en la vacía (en blanco y sin dirección) hasta que la página termine.
  const realKey = realIds.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change in the real tabs can bring the new one
  useEffect(() => {
    const o = opening.current;
    const tab = o && adopted(o.known, realIds);
    if (!o || !tab) return;
    opening.current = undefined;
    dropBlank(o.blank);
    setPicked(tab);
  }, [realKey]);
  useEffect(() => {
    if (activeId && !poppedOut) window.coloniaDesktop?.showBrowserTab?.(activeId);
  }, [activeId, poppedOut]);

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
          value={shownId}
          onValueChange={setPicked}
          onClose={close}
          onNew={() => {
            const b = blankId();
            setBlanks((all) => [...all, b]);
            setPicked(b);
          }}
          newLabel={t("browser.newTab")}
          closeLabel={t("browser.closeTab")}
          tabs={[
            ...tabs.map((x) => ({ id: x.tab, title: x.title || hostPath(x.url), url: x.url, holder: x.control.kind })),
            ...blanks.map((b) => ({ id: b, title: t("browser.newTab") })),
          ]}
        />
      </div>
      <div className="navegador__bar">
        <BrowserToolbar
          forward
          key={shownId ?? "new"}
          tab={active}
          profile={profile}
          onOpening={startOpening}
          onOpened={(tab) => opened(blank, tab)}
          onCancel={() => blank && close(blank)}
        />
      </div>
      {/* MARCADORES-2: la barra está siempre que el perfil se haya leído; vacía, lo dice en vez de desaparecer. */}
      {bar ? <BookmarksBar nodes={bar} open={(u) => void openBookmark(u)} /> : null}
      {!activeId ? (
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
