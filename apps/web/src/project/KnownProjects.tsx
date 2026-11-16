import type { Project } from "@colonia/protocol";
import { Field } from "@colonia/ui";
import { useState } from "react";
import { ProjectAvatar } from "../common/ProjectAvatar.tsx";
import { ProjectsPick } from "../common/pickers/ProjectsPick.tsx";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { updateProject } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { projectsKnowing, projectsUnder } from "../shell/projectTree.ts";

const NONE = "~none";

/**
 * The projects this one's agents may read from, and the project it sits under in the sidebar (DECISIONS.md#d-191).
 * Each change is saved at once. A choice that would close a loop is listed but off, with the reason on hover, so the
 * core never has to refuse one.
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
  const parent = listed.find((p) => p.id === project.parent && !under.has(p.id))?.id ?? NONE;
  const loops = new Map(
    [...projectsKnowing(projects, project.id)].flatMap((id) => {
      const p = listed.find((x) => x.id === id);
      return p ? [[id, t("project.settings.knowsLoop", { name: p.name })] as const] : [];
    }),
  );
  return (
    <>
      <Field label={t("project.settings.knows")} hint={t("project.settings.knowsHint")}>
        <ProjectsPick
          label={t("project.settings.knows")}
          empty={t("project.settings.knowsNone")}
          value={project.knows ?? []}
          exclude={[project.id]}
          blocked={loops}
          disabled={busy}
          onChange={(knows) => void save({ knows })}
        />
      </Field>
      {listed.length > 0 && (
        <Field label={t("project.settings.parent")} hint={t("project.settings.parentHint")}>
          <SearchSelect
            label={t("project.settings.parent")}
            searchPlaceholder={t("pickers.searchProject")}
            emptyLabel={t("pickers.noMatch")}
            value={parent}
            disabled={busy}
            options={[
              { value: NONE, label: t("project.settings.parentNone") },
              ...[...listed.filter((p) => !under.has(p.id)), ...listed.filter((p) => under.has(p.id))].map((p) => ({
                value: p.id,
                label: p.name,
                icon: <ProjectAvatar id={p.id} name={p.name} size={16} />,
                ...(under.has(p.id)
                  ? { disabled: true, title: t("project.settings.parentLoop", { name: p.name }) }
                  : {}),
              })),
            ]}
            onValueChange={(v) => {
              if (v && v !== parent && !under.has(v)) void save({ parent: v === NONE ? null : v });
            }}
          />
        </Field>
      )}
    </>
  );
}
