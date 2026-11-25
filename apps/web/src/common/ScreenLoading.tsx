import { Spinner } from "@colonia/ui";
import { useT } from "../i18n/index.ts";

/** A visible, announced wait while a screen or its initial content arrives. */
export function ScreenLoading() {
  const t = useT();
  return (
    <div className="screen-loading" role="status">
      <Spinner />
      <span>{t("common.loading")}</span>
    </div>
  );
}
