import { Badge } from "@colonia/ui";
import { useT } from "../i18n/index.ts";

/** A setup card's state: connected (with its account), a problem, or not connected yet. */
export function CardState({
  on,
  error,
  account,
}: {
  on: boolean;
  error?: string | undefined;
  account?: string | undefined;
}) {
  const t = useT();
  if (on)
    return (
      <Badge tone="brand" dot>
        {account ?? t("setup.channels.connected")}
      </Badge>
    );
  if (error)
    return (
      <Badge tone="danger" dot>
        {t("setup.channels.problem")}
      </Badge>
    );
  return <Badge tone="neutral">{t("setup.channels.notConnected")}</Badge>;
}
