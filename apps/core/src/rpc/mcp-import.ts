// IMPORTAR-CONECTORES-1 · Resources › Connections: «You have N connectors in your other AIs · Import».

import { serverName } from "../import/apply-extras.ts";
import { findGlobalMcps, type GlobalHomes, importGlobalMcps } from "../import/global-mcps.ts";
import type { InternalCall } from "./internal.ts";
import type { Handlers } from "./router.ts";

const OWNER = { actor: "human" } as const;

export function mcpImportHandlers(homes: GlobalHomes, call: InternalCall) {
  return {
    "mcp.importable": async () => {
      const mine = (await call("mcp.list", {}, OWNER)).servers.filter((s) => s.scope === "global");
      const servers = findGlobalMcps(homes)
        .filter((m) => !mine.some((s) => s.name === serverName(m.name) || (m.server.url && s.target === m.server.url)))
        .map((m) => ({
          key: m.key,
          name: m.name,
          sources: m.sources,
          local: m.local,
          target: m.server.url ?? [m.server.command, ...(m.server.args ?? [])].join(" "),
          stored: m.stored,
          needs: m.needs,
        }));
      return { servers };
    },
    "mcp.import": ({ keys, values }) => importGlobalMcps(call, findGlobalMcps(homes), keys, values),
  } satisfies Partial<Handlers>;
}
