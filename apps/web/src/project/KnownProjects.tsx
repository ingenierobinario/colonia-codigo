import type { Project } from "@colonia/protocol";
import { Field } from "@colonia/ui";
import { useState } from "react";
import { ProjectAvatar } from "../common/ProjectAvatar.tsx";
import { ProjectsPick } from "../common/pickers/ProjectsPick.tsx";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { projectsUnder } from "../shell/projectTree.ts";

const NONE = "~none";

/**
 * The projects this one's agents may read from, and the project it sits under in the sidebar (DECISIONS.md#d-191).
 * Each change is saved at once: the core refuses a loop and says why.
 */
export function KnownProjects({ project }: { project: Project }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const listed = projects.filter((p) => p.registered !== false && p.id !== project.id);
  const save = async (patch: { knows?: string[]; parent?: string | null }) => {
    setBusy(true);
    await updateProject({ project: project.id, ...patch });
    setBusy(false);
  };
  const under = projectsUnder(projects, project.id);
  const parents = listed.filter((p) => !under.has(p.id));
  const parent = parents.find((p) => p.id === project.parent)?.id ?? NONE;
  return (
    <>
      <Field label={t("project.settings.knows")} hint={t("project.settings.knowsHint")}>
        <ProjectsPick
          label={t("project.settings.knows")}
          empty={t("project.settings.knowsNone")}
          value={project.knows ?? []}
          exclude={[project.id]}
          disabled={busy}
          onChange={(knows) => void save({ knows })}
        />
      </Field>
      {parents.length > 0 && (
        <Field label={t("project.settings.parent")} hint={t("project.settings.parentHint")}>
          <SearchSelect
            label={t("project.settings.parent")}
            searchPlaceholder={t("pickers.searchProject")}
            emptyLabel={t("pickers.noMatch")}
            value={parent}
            disabled={busy}
            options={[
              { value: NONE, label: t("project.settings.parentNone") },
              ...parents.map((p) => ({
                value: p.id,
                label: p.name,
                icon: <ProjectAvatar id={p.id} name={p.name} size={16} />,
              })),
            ]}
            onValueChange={(v) => {
              if (v && v !== parent) void save({ parent: v === NONE ? null : v });
            }}
          />
        </Field>
      )}
    </>
  );
}
