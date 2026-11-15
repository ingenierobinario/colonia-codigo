import { Icons } from "@colonia/ui";
import { useT } from "../i18n/index.ts";
import { channelProblem, problemKey } from "./problems.ts";

/** A channel's error as what to do about it; what the service answered stays one hover away. */
export function ProblemLine({ error }: { error: string | null | undefined }) {
  const t = useT();
  const problem = channelProblem(error);
  if (!problem) return null;
  return (
    <div className="chproblem" role="alert" title={error ?? undefined}>
      <Icons.TriangleAlert size={14} />
      <span>{t(problemKey(problem))}</span>
    </div>
  );
}
