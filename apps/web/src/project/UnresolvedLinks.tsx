import type { Project } from "@colonia/protocol";
import { Button, Icons, Tag } from "@colonia/ui";
import { useState } from "react";
import { ProjectAvatar } from "../common/ProjectAvatar.tsx";
import { MAX_PICKED } from "../common/pickers/ProjectsPick.tsx";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { projectsKnowing } from "../shell/projectTree.ts";

/**
 * The projects a shared project read from that nobody has here under that name (DECISIONS.md#d-191): each one named,
 * with a picker that links it to one of this person's projects right here. Left alone, nothing breaks.
 */
export function UnresolvedLinks({ project, names }: { project: Project; names: readonly string[] }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [knows, setKnows] = useState<readonly string[]>(project.knows ?? []);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const listed = projects.filter((p) => p.registered !== false && p.id !== project.id);
  const loops = projectsKnowing(projects, project.id);
  const why = (p: { id: string; name: string }) =>
    knows.includes(p.id)
      ? t("pshare.import.linkTaken", { name: p.name })
      : loops.has(p.id)
        ? t("project.settings.knowsLoop", { name: p.name })
        : undefined;
  const options = [...listed.filter((p) => !why(p)), ...listed.filter((p) => why(p))].map((p) => {
    const title = why(p);
    return {
      value: p.id,
      label: p.name,
      icon: <ProjectAvatar id={p.id} name={p.name} size={16} />,
      ...(title ? { disabled: true, title } : {}),
    };
  });
  const link = async (name: string, id: string) => {
    setBusy(true);
    const saved = await updateProject({ project: project.id, knows: [...knows, id] });
    setBusy(false);
    if (!saved) return;
    setKnows(saved.knows ?? []);
    setLinked((l) => ({ ...l, [name]: id }));
  };
  const full = knows.length >= MAX_PICKED;
  return (
    <section className="pshare__card" data-testid="pshare-unresolved">
      <h3>{t("pshare.import.unresolved")}</h3>
      <p>{t(listed.length ? "pshare.import.unresolvedBody" : "pshare.import.unresolvedAlone")}</p>
      <ul className="pshare__pending">
        {names.map((name) => {
          const to = listed.find((p) => p.id === linked[name]);
          return (
            <li key={name} data-unresolved={name}>
              <div>
                <strong>{name}</strong>
              </div>
              {to ? (
                <Tag icon={<Icons.Check size={12} />}>{t("pshare.import.linked", { name: to.name })}</Tag>
              ) : (
                listed.length > 0 && (
                  <SearchSelect
                    label={t("pshare.import.linkTo", { name })}
                    searchPlaceholder={t("pickers.searchProject")}
                    emptyLabel={t("pickers.noMatch")}
                    value={null}
                    disabled={busy || full}
                    options={options}
                    onValueChange={(id) => {
                      const p = listed.find((x) => x.id === id);
                      if (p && !why(p)) void link(name, p.id);
                    }}
                    trigger={
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t("pshare.import.linkTo", { name })}
                        title={full ? t("pshare.import.linkFull", { n: MAX_PICKED }) : undefined}
                        disabled={busy || full}
                      >
                        {t("pshare.import.linkPick")}
                      </Button>
                    }
                  />
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
