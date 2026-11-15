import { enHelper } from "./en-helper.ts";
import { enProjectShare } from "./en-project-share.ts";
import { enResources } from "./en-resources.ts";
import { enSetup } from "./en-setup.ts";
import { enTeam } from "./en-team.ts";
import { enTelemetry } from "./en-telemetry.ts";

// Strings of the screens opened after the first one (setup, team, resources, helper, usage sharing): one late
// chunk, fetched once the first screen is up and awaited by every late screen (lazy.ts), never by the first paint.
export const enScreens = {
  ...enHelper,
  ...enSetup,
  ...enTeam,
  ...enResources,
  ...enTelemetry,
  ...enProjectShare,
};
