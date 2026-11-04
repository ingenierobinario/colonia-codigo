// How `colonia expose` changes core.env: the plan itself is shared with the core (packages/protocol exposure.ts).
import { isLoopback } from "@colonia/protocol";

export { type ExposeMode, type Exposure, newToken, planExposure, tailscaleDnsName } from "@colonia/protocol";

/** What the core will do with these settings, in words. */
export function describeExposure(vars: Record<string, string>): string {
  const host = vars.COLONIA_HOST;
  if (vars.COLONIA_PUBLIC_URL)
    return `published at ${vars.COLONIA_PUBLIC_URL}${host && !isLoopback(host) ? ` and listening on ${host}` : " (the core itself stays on this computer)"}`;
  if (host && !isLoopback(host)) return `listening on ${host}: other devices on the network can reach it`;
  return "only this computer can reach the core";
}
