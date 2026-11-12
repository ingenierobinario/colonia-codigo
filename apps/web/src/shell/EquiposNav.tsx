import type { Equipo } from "@colonia/protocol";
import { Icons, NavItem } from "@colonia/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";
import { SidebarSection } from "./SidebarSection.tsx";

/** «Mis equipos»: los portátiles emparejados, con un punto verde si están conectados, y la entrada para añadir otro. */
export function EquiposNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.equiposFolded);
  const view = useNav((s) => s.view);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await client.withSignal(abort.signal).call("equipos.list", {});
        if (!abort.signal.aborted) setEquipos(r.equipos);
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
  }, []);
  const hidden = folded && !rail;
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.equipos")}
        folded={folded}
        onToggle={() => setPrefs({ equiposFolded: !folded })}
      />
      {!hidden &&
        equipos.map((e) => (
          <NavItem
            key={e.id}
            collapsed={rail}
            icon={<Icons.Monitor />}
            label={e.name}
            trailing={e.connected ? <span className="navitem__running" title={t("equipos.connected")} /> : undefined}
            active={view === "equipos"}
            onClick={() => go.view("equipos")}
          />
        ))}
      {!hidden && (
        <NavItem
          collapsed={rail}
          icon={<Icons.Plus />}
          label={t("nav.equiposAdd")}
          active={view === "equipos" && equipos.length === 0}
          onClick={() => go.view("equipos")}
        />
      )}
    </>
  );
}
