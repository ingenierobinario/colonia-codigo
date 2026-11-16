import "../../styles/projpick.css";
import { Button, IconButton, Icons } from "@colonia/ui";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { ProjectAvatar } from "../ProjectAvatar.tsx";
import { SearchSelect } from "./SearchSelect.tsx";

/** The most projects one project or Flow reads from, as the core takes them. */
export const MAX_PICKED = 16;

/**
 * Several projects, each with its tile: the ones chosen as removable rows and a button that adds another. A chosen
 * project no longer listed is left out, so the next change never sends one the core does not know.
 */
export function ProjectsPick({
  value,
  onChange,
  exclude,
  fixed,
  fixedNote,
  label,
  empty,
  disabled,
}: {
  value: readonly string[];
  onChange(next: string[]): void;
  /** Projects that cannot be chosen: its own. */
  exclude?: readonly string[];
  /** A project shown first that cannot be removed (a Flow's own). */
  fixed?: string | undefined;
  fixedNote?: string;
  /** Accessible name of the list. */
  label: string;
  /** What it says with none chosen. */
  empty: string;
  disabled?: boolean;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const listed = projects.filter((p) => p.registered !== false);
  const own = listed.find((p) => p.id === fixed);
  const chosen = value.flatMap((id) => listed.find((p) => p.id === id && p.id !== fixed) ?? []);
  const ids = chosen.map((p) => p.id);
  const free = listed.filter((p) => !ids.includes(p.id) && p.id !== fixed && !exclude?.includes(p.id));
  return (
    <div className="projpick">
      {own || chosen.length ? (
        <ul className="projpick__list" aria-label={label}>
          {own && (
            <li className="projpick__row">
              <ProjectAvatar id={own.id} name={own.name} size={20} />
              <span className="projpick__name">{own.name}</span>
              {fixedNote && <span className="projpick__note">{fixedNote}</span>}
            </li>
          )}
          {chosen.map((p) => (
            <li key={p.id} className="projpick__row" data-picked={p.id}>
              <ProjectAvatar id={p.id} name={p.name} size={20} />
              <span className="projpick__name">{p.name}</span>
              <IconButton
                size="sm"
                label={t("pickers.projects.remove", { name: p.name })}
                icon={<Icons.X />}
                disabled={disabled}
                onClick={() => onChange(ids.filter((id) => id !== p.id))}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {!chosen.length && <p className="projpick__none">{free.length ? empty : t("pickers.projects.noOthers")}</p>}
      {free.length > 0 && ids.length < MAX_PICKED && (
        <SearchSelect
          label={t("pickers.projects.add")}
          searchPlaceholder={t("pickers.searchProject")}
          emptyLabel={t("pickers.noMatch")}
          value={null}
          {...(disabled ? { disabled } : {})}
          options={free.map((p) => ({
            value: p.id,
            label: p.name,
            icon: <ProjectAvatar id={p.id} name={p.name} size={16} />,
          }))}
          onValueChange={(id) => id && onChange([...ids, id])}
          trigger={
            <Button
              variant="secondary"
              size="sm"
              className="projpick__add"
              disabled={disabled}
              leadingIcon={<Icons.Plus size={14} />}
            >
              {t("pickers.projects.add")}
            </Button>
          }
        />
      )}
    </div>
  );
}
