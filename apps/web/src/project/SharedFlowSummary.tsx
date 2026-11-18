import type { ProjectImport } from "../data/project-share.ts";
import { useT } from "../i18n/index.ts";

export function SharedFlowSummary({ value }: { value: Pick<ProjectImport, "flows" | "flow_review"> }) {
  const t = useT();
  if (!value.flows && !value.flow_review?.length) return null;
  return (
    <div data-testid="pshare-flows">
      {Boolean(value.flows) && <p>{t("pshare.flows.count", { n: value.flows ?? 0 })}</p>}
      {value.flow_review?.map((reason) => (
        <p key={reason}>{t(`pshare.flows.${reason}`)}</p>
      ))}
    </div>
  );
}
