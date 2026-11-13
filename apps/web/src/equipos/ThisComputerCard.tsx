// ESTE-EQUIPO-1 · La ficha del ordenador donde corre Colonia: nombre, dirección y estado. No se conecta ni se
// desconecta, así que no lleva botón «Desconectar» ni pasos de acceso remoto.
import type { EquipoLocal } from "@colonia/protocol";
import { Badge, Icons } from "@colonia/ui";
import { useT } from "../i18n/index.ts";
import { EquipoName } from "./EquipoName.tsx";
import type { EquipoEntry } from "./equiposModel.ts";

const SYSTEM: Record<EquipoLocal["platform"], string | undefined> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  other: undefined,
};

export function ThisComputerCard({
  local,
  e,
  all,
  edit,
  onSaved,
}: {
  local: EquipoLocal;
  e: EquipoEntry;
  all: EquipoEntry[];
  edit: number;
  onSaved: () => void;
}) {
  const t = useT();
  const [address, ...more] = local.addresses;
  const system = SYSTEM[local.platform];
  return (
    <section className="eq-card" data-equipo-id={e.id} aria-label={t("equipos.thisBadge")}>
      <div className="eq-row">
        <span className="eq-name">
          <span className="eq-dot eq-dot--on" />
          <Icons.Monitor />
          <EquipoName e={e} all={all} edit={edit} onSaved={onSaved} />
        </span>
        <Badge tone="brand">{t("equipos.thisBadge")}</Badge>
      </div>
      <dl className="eq-facts">
        <div className="eq-fact">
          <dt>{t("equipos.thisAddress")}</dt>
          <dd title={more.length > 0 ? [address, ...more].join(" · ") : undefined}>
            {address ?? t("equipos.thisNoAddress")}
          </dd>
        </div>
        <div className="eq-fact">
          <dt>{t("equipos.thisState")}</dt>
          <dd>{t("equipos.thisOn")}</dd>
        </div>
        {system && (
          <div className="eq-fact">
            <dt>{t("equipos.thisSystem")}</dt>
            <dd>{system}</dd>
          </div>
        )}
      </dl>
      <p className="eq-muted eq-facts__hint">{t("equipos.thisHint")}</p>
    </section>
  );
}
