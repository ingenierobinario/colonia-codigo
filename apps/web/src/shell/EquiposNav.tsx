import type { Equipo, EquipoLocal } from "@colonia/protocol";
import { ContextMenu, Icons, NavItem } from "@colonia/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { focusEquipo, useEquipoFocus, useEquiposChanged } from "../equipos/equiposFocus.ts";
import { equipoEntries, realName } from "../equipos/equiposModel.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";
import { SidebarSection } from "./SidebarSection.tsx";

/**
 * «Mis equipos»: este ordenador el primero (ESTE-EQUIPO-1), los equipos conectados con un punto verde si lo están, y la
 * entrada para añadir otro. Clic derecho: cambiarle el nombre (EQUIPOS-ALIAS-1).
 */
export function EquiposNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.equiposFolded);
  const view = useNav((s) => s.view);
  const focus = useEquipoFocus();
  const changed = useEquiposChanged();
  const [list, setList] = useState<{ equipos: Equipo[]; local?: EquipoLocal }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` vuelve a pedir la lista sin esperar al sondeo
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await client.withSignal(abort.signal).call("equipos.list", {});
        if (!abort.signal.aborted) setList(r);
      } catch {
        /* sin conexión con el servidor: se reintenta */
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 10_000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [changed]);
  const entries = equipoEntries(list);
  const hidden = folded && !rail;
  const open = (id: string, edit = false) => {
    focusEquipo(id, edit);
    go.view("equipos");
  };
  // Con la pantalla abierta se marca la ficha a la que se fue; si no se eligió ninguna, la primera.
  const current = entries.some((e) => e.id === focus?.id) ? focus?.id : entries[0]?.id;
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.equipos")}
        folded={folded}
        onToggle={() => setPrefs({ equiposFolded: !folded })}
      />
      {!hidden &&
        entries.map((e) => {
          const host = realName(e);
          const hint = [e.self ? t("nav.equipoThis") : "", host ?? ""].filter(Boolean).join(" · ");
          return (
            <ContextMenu
              key={e.id}
              items={[{ label: t("nav.equipoRename"), icon: <Icons.Pencil />, onSelect: () => open(e.id, true) }]}
            >
              <NavItem
                collapsed={rail}
                icon={<Icons.Monitor />}
                label={rail ? e.name : <span title={hint || undefined}>{e.name}</span>}
                trailing={
                  e.self ? (
                    <span className="navitem__self" title={hint}>
                      {t("nav.equipoThis")}
                    </span>
                  ) : e.connected ? (
                    <span className="navitem__running" title={t("nav.equipoConnected")} />
                  ) : undefined
                }
                active={view === "equipos" && current === e.id}
                onClick={() => open(e.id)}
              />
            </ContextMenu>
          );
        })}
      {!hidden && (
        <NavItem
          collapsed={rail}
          icon={<Icons.Plus />}
          label={t("nav.equiposAdd")}
          active={view === "equipos" && entries.length === 0}
          onClick={() => go.view("equipos")}
        />
      )}
    </>
  );
}
