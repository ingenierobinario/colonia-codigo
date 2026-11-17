// NAVEGADORES-2: la barra de marcadores del perfil del navegador real, bajo la dirección, como en el propio navegador:
// marcadores y carpetas (una carpeta se abre como menú); lo que no cabe va a «»». Solo lectura, del perfil.
import { Icons, Menu, type MenuEntry } from "@colonia/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookmarkNode } from "../colonia-desktop.d.ts";
import { navegadorId } from "../data/navegadores.ts";
import { useT } from "../i18n/index.ts";

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const label = (n: BookmarkNode) => n.titulo || ("url" in n ? host(n.url) : "…");

/** La barra del perfil con este id de Navegadores; undefined mientras carga o sin escritorio, [] si no tiene. */
export function useBookmarkBar(id: string | undefined) {
  const [profile, setProfile] = useState<{ id: string; source?: string; bar: BookmarkNode[] }>();
  useEffect(() => {
    const d = window.coloniaDesktop;
    // MARCADORES-2: sin escritorio no hay perfil que leer: ni barra ni aviso de «vacía».
    if (!id || !d?.importSources || !d.bookmarkBar) return;
    let live = true;
    d.importSources()
      .then(async (sources) => {
        const s = sources.find((x) => navegadorId(x.navegador, x.perfil) === id);
        const bar = s ? await d.bookmarkBar?.(s.id).catch(() => []) : [];
        return { id, ...(s ? { source: s.id } : {}), bar: bar ?? [] };
      })
      .then(
        (result) => live && setProfile(result),
        () => live && setProfile({ id, bar: [] }),
      );
    return () => {
      live = false;
    };
  }, [id]);
  return profile?.id === id ? profile : undefined;
}

function entries(nodes: BookmarkNode[], open: (url: string) => void, empty: string): MenuEntry[] {
  if (!nodes.length) return [{ type: "label", label: empty }];
  return nodes.map(
    (n): MenuEntry =>
      "url" in n
        ? { label: label(n), icon: <Icons.Globe size={14} />, onSelect: () => open(n.url) }
        : { type: "submenu", label: label(n), icon: <Icons.Folder size={14} />, items: entries(n.hijos, open, empty) },
  );
}

function Item({ node, open, empty }: { node: BookmarkNode; open: (url: string) => void; empty: string }) {
  if ("url" in node)
    return (
      <button type="button" className="bmbar__item" title={node.url} onClick={() => open(node.url)}>
        <Icons.Globe size={13} />
        <span className="bmbar__text">{label(node)}</span>
      </button>
    );
  return (
    <Menu
      className="bmbar__menu"
      trigger={
        <button type="button" className="bmbar__item" title={label(node)}>
          <Icons.Folder size={13} />
          <span className="bmbar__text">{label(node)}</span>
        </button>
      }
      items={entries(node.hijos, open, empty)}
    />
  );
}

const GAP = 2;
const MORE = 30;

export function BookmarksBar({ nodes, open }: { nodes: BookmarkNode[]; open: (url: string) => void }) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(nodes.length);
  const items = useMemo(() => {
    const counts = new Map<string, number>();
    return nodes.map((node) => {
      const bookmark = JSON.stringify([node.titulo, "url" in node ? node.url : null]);
      const occurrence = counts.get(bookmark) ?? 0;
      counts.set(bookmark, occurrence + 1);
      return { node, key: `${bookmark}-${occurrence}` };
    });
  }, [nodes]);

  // Cuántos caben: cada elemento se mide en una copia oculta de la fila; el resto va a «»».
  useLayoutEffect(() => {
    const el = row.current;
    const m = measure.current;
    if (!el || !m) return;
    const calc = () => {
      const room = el.clientWidth;
      let used = 0;
      let n = 0;
      for (const i of nodes.keys()) {
        const child = m.children.item(i);
        if (!child) break;
        const w = child.getBoundingClientRect().width;
        const next = used + (n ? GAP : 0) + w;
        const more = n + 1 < nodes.length ? GAP + MORE : 0;
        if (next + more > room) break;
        used = next;
        n++;
      }
      setFit(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    for (const child of m.children) ro.observe(child);
    return () => ro.disconnect();
  }, [nodes]);

  // MARCADORES-2: sin marcadores en la barra, la barra sigue ahí con un aviso discreto (no desaparece).
  if (!nodes.length)
    return (
      <nav className="bmbar" aria-label={t("navegadores.bookmarks")}>
        <div className="bmbar__row">
          <span className="bmbar__none">{t("navegadores.bookmarksNone")}</span>
        </div>
      </nav>
    );
  const rest = nodes.slice(fit);
  const empty = t("navegadores.bookmarksEmptyFolder");
  return (
    <nav className="bmbar" aria-label={t("navegadores.bookmarks")}>
      <div className="bmbar__row" ref={row}>
        {items.slice(0, fit).map(({ node, key }) => (
          <Item key={key} node={node} open={open} empty={empty} />
        ))}
        {rest.length > 0 && (
          <Menu
            align="end"
            className="bmbar__menu"
            trigger={
              <button
                type="button"
                className="bmbar__item bmbar__more"
                aria-label={t("navegadores.bookmarksMore")}
                title={t("navegadores.bookmarksMore")}
              >
                »
              </button>
            }
            items={entries(rest, open, empty)}
          />
        )}
      </div>
      <div className="bmbar__measure" ref={measure} aria-hidden="true">
        {items.map(({ node: n, key }) => (
          <span key={key} className="bmbar__item">
            {"url" in n ? <Icons.Globe size={13} /> : <Icons.Folder size={13} />}
            <span className="bmbar__text">{label(n)}</span>
          </span>
        ))}
      </div>
    </nav>
  );
}
