import { esHelper } from "./es-helper.ts";
import { esProjectShare } from "./es-project-share.ts";
import { esResources } from "./es-resources.ts";
import { esSetup } from "./es-setup.ts";
import { esTeam } from "./es-team.ts";
import { esTelemetry } from "./es-telemetry.ts";
import type { enScreens } from "./screens-en.ts";

// Spanish of screens-en.ts.
export const esScreens: Partial<Record<keyof typeof enScreens, string>> = {
  ...esHelper,
  ...esSetup,
  ...esTeam,
  ...esResources,
  ...esTelemetry,
  ...esProjectShare,
};
