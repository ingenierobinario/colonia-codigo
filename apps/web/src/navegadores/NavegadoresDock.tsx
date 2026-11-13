// NAVEGADORES-1: the owner's browsers in the sidebar. Each browser (Chrome, Edge…) folds its profiles, shown with
// their real names; "+" lists the profiles found on this computer and adding one is all it does.
import { ContextMenu, IconButton, Icons, Menu, type MenuEntry, NavItem, ProjectTile } from "@colonia/ui";
import { useEffect, useState } from "react";
import type { ImportSource } from "../colonia-desktop.d.ts";
import { BROWSER_NAMES, loadNavegadores, navegadorId, saveNavegador, useNavegadores } from "../data/navegadores.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SidebarSection } from "../shell/SidebarSection.tsx";
import { BrowserLogo } from "./BrowserLogo.tsx";

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

  const refresh = () => {
    void window.coloniaDesktop?.importSources?.().then(setSources, () => setSources([]));
  };
  useEffect(() => {
    void loadNavegadores();
    void window.coloniaDesktop?.importSources?.().then(setSources, () => setSources([]));
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
  // "+" › Chrome › its profiles, by their own names.
  const items: MenuEntry[] = free.length
    ? ORDER.filter((b) => free.some((s) => s.navegador === b)).map((b) => ({
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
      }))
    : [{ type: "label", label: sources ? t("navegadores.noneLeft") : t("navegadores.looking") }];
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
