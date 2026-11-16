import { Button, Icons, Popover } from "@colonia/ui";
import { ProjectsPick } from "../common/pickers/ProjectsPick.tsx";
import { useT } from "../i18n/index.ts";

/**
 * The projects whose knowledge a Flow's agents can read (DECISIONS.md#d-191): its own, always, and the ones its owner
 * adds here. They only read there.
 */
export function FlowKnowledge({
  projectId,
  value,
  onChange,
  disabled,
}: {
  /** The Flow's own project; none yet on a new Flow. */
  projectId: string | undefined;
  value: readonly string[];
  onChange(next: string[]): void;
  disabled?: boolean;
}) {
  const t = useT();
  const others = value.filter((id) => id !== projectId).length;
  return (
    <Popover
      align="end"
      width={320}
      label={t("flow.ed.knowledgeTitle")}
      trigger={
        <Button
          variant="secondary"
          className="fe-top__know"
          leadingIcon={<Icons.BookOpen size={14} />}
          aria-label={t("flow.ed.knowledgeCount", { n: others + 1 })}
          title={t("flow.ed.knowledgeTitle")}
        >
          <span className="fe-top__know-text">{t("flow.ed.knowledge")}</span>
          {others > 0 && <span className="fe-top__know-n">{others + 1}</span>}
        </Button>
      }
    >
      <div className="fe-know">
        <strong className="fe-know__title">{t("flow.ed.knowledgeTitle")}</strong>
        <p className="fe-know__hint">{t("flow.ed.knowledgeHint")}</p>
        <ProjectsPick
          label={t("flow.ed.knowledgeTitle")}
          empty={t("flow.ed.knowledgeNone")}
          value={value}
          fixed={projectId}
          fixedNote={t("flow.ed.knowledgeOwn")}
          {...(disabled ? { disabled } : {})}
          onChange={onChange}
        />
      </div>
    </Popover>
  );
}
