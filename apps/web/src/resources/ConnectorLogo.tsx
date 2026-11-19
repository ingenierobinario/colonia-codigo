import { Icons } from "@colonia/ui";
import { useState } from "react";

/** The service's own logo (its favicon, large), the plug if it does not load. */
export function ConnectorLogo({ domain, size = 28 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Icons.Plug size={22} />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
