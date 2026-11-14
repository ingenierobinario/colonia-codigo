// NAVEGADORES-1: the owner's browsers in the sidebar. Each browser (Chrome, Edge…) folds its profiles, shown with
// their real names; "+" lists the profiles found on this computer and adding one is all it does.
// INSTALAR-NAV-1: "+" also offers, always, the browsers this computer lacks: picking one installs it from its maker,
// shows how it goes in a card here and, once it is found, adds it to the bar.
import { ContextMenu, IconButton, Icons, Menu, type MenuEntry, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import type { BrowserInstallProgress, ImportSource } from "../colonia-desktop.d.ts";
import { browserOpen } from "../data/actions.ts";
import {
  BROWSER_NAMES,
  currentNavegadores,
  loadNavegadores,
  navegadorId,
  saveNavegador,
  useNavegadores,
} from "../data/navegadores.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { forgetInstalledBrowsers } from "../panel/browserWindow.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { SidebarSection } from "../shell/SidebarSection.tsx";
import { BrowserLogo } from "./BrowserLogo.tsx";
import { InstalarNavegador } from "./InstalarNavegador.tsx";
import { entriesFor, installBusy, withoutProfile } from "./instalar.ts";

type Named = { id: string; name: string };
const named = (list: unknown): Named[] =>
  Array.isArray(list) ? list.filter((b) => typeof b?.id === "string" && typeof b?.name === "string") : [];
/** The maker's page, in Colonia's own browser: it works on a computer with no browser at all (SIN-NAVEGADOR-1). */
const openPage = (url: string) =>
  void browserOpen(url).then((tab) => tab && nav.set({ panel: "browser", browserTab: tab }));

type Browser = keyof typeof BROWSER_NAMES;
const ORDER = Object.keys(BROWSER_NAMES) as Browser[];

export function NavegadoresDock({ rail }: { rail: boolean }) {
  const t = useT();
  const navegadores = useNavegadores((s) => s.navegadores);
  const view = useNav((s) => s.view);
  const current = useNav((s) => s.navegadorId);
  const [sources, setSources] = useState<ImportSource[]>();
  const [folded, setFolded] = useState<Partial<Record<Browser, boolean>>>({});
  const sectionFolded = usePrefs((s) => s.navegadoresFolded); // PLEGAR-SECCIONES-1
  const desktop = typeof window.coloniaDesktop?.importSources === "function";
  // INSTALAR-NAV-1
  const [installable, setInstallable] = useState<Named[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [install, setInstall] = useState<BrowserInstallProgress>();
  const dropped = useRef(false); // the owner cancelled: what the installer says from then on is not shown
  const pageShown = useRef<string | undefined>(undefined);

  const refresh = () => {
    const d = window.coloniaDesktop;
    void d?.importSources?.().then(setSources, () => setSources([]));
    // What is missing first: that look refreshes what the desktop knows is installed.
    void (async () => {
      setInstallable(named(await d?.installableBrowsers?.().catch(() => [])));
      setInstalled(named(await d?.installedBrowsers?.().catch(() => [])).map((b) => b.id));
    })();
  };
  useEffect(() => {
    void loadNavegadores();
    void window.coloniaDesktop?.importSources?.().then(setSources, () => setSources([]));
    return window.coloniaDesktop?.onBrowserInstall?.((p) => {
      if (dropped.current) return;
      setInstall(p);
      // Nothing to run for this one here: its maker's page, once.
      if (p.phase === "waiting" && p.step === "page" && pageShown.current !== p.id) {
        pageShown.current = p.id;
        openPage(p.page);
      }
    });
  }, []);

  if (!desktop && !navegadores.length) return null;

  const added = new Set(navegadores.map((n) => n.id));
  const free = (sources ?? []).filter((s) => !added.has(navegadorId(s.navegador, s.perfil)));
  const add = (s: ImportSource) =>
    void saveNavegador(navegadorId(s.navegador, s.perfil), {
      browser: s.navegador,
      name: s.nombre ?? s.perfil,
      ...(s.email ? { email: s.email } : {}),
    });
  // INSTALAR-NAV-1: installs one and, once the computer has it, puts it in the bar (its profiles, or itself).
  const addBrowser = async (browser: string) => {
    const found = (await window.coloniaDesktop?.importSources?.().catch(() => undefined)) ?? sources ?? [];
    setSources(found);
    const now = currentNavegadores();
    for (const { id, ...navegador } of entriesFor(browser, found, now, t("navegadores.mainProfile")))
      await saveNavegador(id, navegador);
  };
  const startInstall = async (b: Named) => {
    if (installBusy(install)) return;
    dropped.current = false;
    pageShown.current = undefined;
    setInstall({ id: b.id, name: b.name, page: "", phase: "installing" });
    const end = await window.coloniaDesktop?.installBrowser?.(b.id).catch(() => undefined);
    if (dropped.current) return;
    if (end?.phase === "done") {
      forgetInstalledBrowsers();
      await addBrowser(b.id);
    }
    setInstall(end ?? { id: b.id, name: b.name, page: "", phase: "failed" });
    refresh();
  };
  const cancelInstall = () => {
    dropped.current = true;
    window.coloniaDesktop?.cancelBrowserInstall?.();
    setInstall(undefined);
  };

  // "+" › Chrome › its profiles, by their own names.
  const profiles: MenuEntry[] = ORDER.filter((b) => free.some((s) => s.navegador === b)).map((b) => ({
    type: "submenu" as const,
    label: BROWSER_NAMES[b],
    icon: <BrowserLogo browser={b} size={14} />, // NAVEGADORES-2: su logo, no un globo
    items: free
      .filter((s) => s.navegador === b)
      .map((s) => ({
        label: s.email ? `${s.nombre ?? s.perfil} · ${s.email}` : (s.nombre ?? s.perfil),
        icon: <Icons.User size={14} />,
        onSelect: () => add(s),
      })),
  }));
  // INSTALAR-NAV-1: installed browsers with no profile to pick (never opened, Opera, Vivaldi, Safari), as themselves.
  const whole: MenuEntry[] = withoutProfile(installed, sources ?? [], navegadores).map((b) => ({
    label: BROWSER_NAMES[b],
    icon: <BrowserLogo browser={b} size={14} />,
    onSelect: () => void addBrowser(b),
  }));
  const here = [...profiles, ...whole];
  // The ones this computer lacks, always: from their makers (SIN-NAVEGADOR-1 offered two, and only with none found).
  const missing: MenuEntry[] = installable.map((b) => ({
    label: t("navegadores.install", { name: b.name }),
    icon: <BrowserLogo browser={b.id} size={14} />,
    disabled: installBusy(install),
    onSelect: () => void startInstall(b),
  }));
  const items: MenuEntry[] = [
    ...(here.length
      ? [{ type: "label" as const, label: t("navegadores.found") }, ...here]
      : [
          {
            type: "label" as const,
            label: !sources
              ? t("navegadores.looking")
              : sources.length || navegadores.length || installed.length
                ? t("navegadores.noneLeft")
                : t("navegadores.none"),
          },
        ]),
    ...(missing.length
      ? [{ type: "separator" as const }, { type: "label" as const, label: t("navegadores.installSection") }, ...missing]
      : []),
  ];
  const browsers = ORDER.filter((b) => navegadores.some((n) => n.browser === b));

  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("navegadores.title")}
        folded={sectionFolded}
        onToggle={() => setPrefs({ navegadoresFolded: !sectionFolded })}
        action={
          desktop ? (
            <Menu
              trigger={
                <IconButton
                  size="sm"
                  className="sidebar__add"
                  label={t("navegadores.add")}
                  icon={<Icons.Plus size={14} />}
                />
              }
              align="end"
              onOpenChange={(o) => o && refresh()}
              items={items}
            />
          ) : undefined
        }
      />
      {install && !rail && (
        <InstalarNavegador
          progress={install}
          onCancel={cancelInstall}
          onClose={() => setInstall(undefined)}
          onOpenPage={() => openPage(install.page)}
        />
      )}
      {!(sectionFolded && !rail) &&
        browsers.map((b) => (
          <div key={b} className="navegadores__group">
            <NavItem
              collapsed={rail}
              icon={<ProjectTile tone="neutral" icon={<BrowserLogo browser={b} size={14} />} />}
              label={BROWSER_NAMES[b]}
              trailing={
                rail ? undefined : folded[b] ? <Icons.ChevronRight size={14} /> : <Icons.ChevronDown size={14} />
              }
              onClick={() => setFolded((f) => ({ ...f, [b]: !f[b] }))}
            />
            {!folded[b] &&
              navegadores
                .filter((n) => n.browser === b)
                .map((n) => (
                  <ContextMenu
                    key={n.id}
                    items={[
                      {
                        label: t("navegadores.remove"),
                        icon: <Icons.Trash2 size={14} />,
                        danger: true,
                        onSelect: () => {
                          void saveNavegador(n.id, null);
                          if (view === "navegador" && current === n.id) go.inbox();
                        },
                      },
                    ]}
                  >
                    <NavItem
                      collapsed={rail}
                      depth={1}
                      icon={<Icons.User size={14} />}
                      label={n.name}
                      active={view === "navegador" && current === n.id}
                      onClick={() => go.navegador(n.id)}
                    />
                  </ContextMenu>
                ))}
          </div>
        ))}
    </>
  );
}
