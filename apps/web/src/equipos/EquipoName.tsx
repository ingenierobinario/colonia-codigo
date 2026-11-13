// EQUIPOS-ALIAS-1 · El nombre de un equipo, que se cambia en el sitio: lápiz, Enter guarda y Esc cancela.
import { IconButton, Icons, Input } from "@colonia/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { editDone, equiposChanged } from "./equiposFocus.ts";
import { ALIAS_MAX, aliasTaken, aliasToSave, type EquipoEntry, realName } from "./equiposModel.ts";

export function EquipoName({
  e,
  all,
  edit = 0,
  onSaved,
}: {
  e: EquipoEntry;
  /** Todos los equipos, para no repetir un nombre. */
  all: EquipoEntry[];
  /** Distinto de cero cuando se pide abrirlo ya para escribir (clic derecho en la barra lateral). */
  edit?: number;
  onSaved: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = () => {
    setValue(e.alias ?? e.name);
    setError("");
    setEditing(true);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo se abre cuando llega una petición nueva
  useEffect(() => {
    if (edit) open();
  }, [edit]);
  const close = () => {
    setEditing(false);
    setError("");
    editDone();
  };
  const save = async () => {
    const alias = aliasToSave(value, e);
    if (alias === (e.alias ?? "")) return close();
    if (aliasTaken(alias, e.id, all)) return setError(t("equipos.renameTaken"));
    setBusy(true);
    try {
      await client.call("equipos.rename", { id: e.id, alias });
      onSaved();
      equiposChanged();
      close();
    } catch {
      setError(t("equipos.failed"));
    }
    setBusy(false);
  };
  const host = realName(e);
  if (!editing)
    return (
      <span className="eq-title">
        <span className="eq-title__name" title={host ? t("equipos.realName", { name: host }) : undefined}>
          {e.name}
        </span>
        <IconButton
          size="sm"
          className="eq-title__edit"
          label={t("equipos.rename")}
          icon={<Icons.Pencil size={14} />}
          onClick={open}
        />
        {host && (
          <span className="eq-muted eq-title__host" title={t("equipos.realName", { name: host })}>
            {host}
          </span>
        )}
      </span>
    );
  return (
    <form
      className="eq-rename"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!busy) void save();
      }}
    >
      <div className="eq-rename__row">
        <Input
          autoFocus
          size="sm"
          aria-label={t("equipos.renameLabel")}
          title={t("equipos.renameHint")}
          placeholder={e.hostname}
          maxLength={ALIAS_MAX}
          invalid={!!error}
          value={value}
          onFocus={(ev) => ev.target.select()}
          onChange={(ev) => {
            setValue(ev.target.value);
            setError("");
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.preventDefault();
              close();
            }
          }}
        />
        <IconButton
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy}
          label={t("common.save")}
          icon={<Icons.Check size={14} />}
        />
        <IconButton size="sm" type="button" label={t("common.cancel")} icon={<Icons.X size={14} />} onClick={close} />
      </div>
      {error && <span className="eq-error eq-rename__error">{error}</span>}
    </form>
  );
}
