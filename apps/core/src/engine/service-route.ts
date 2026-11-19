import type { WebApp } from "@colonia/protocol";
import { browserService } from "../integrations/find.ts";
import { webAppServer } from "../rpc/webapps.ts";
import type { Tool } from "../tools/types.ts";

/** Decide en memoria con las herramientas autorizadas de este turno, antes de abrir una pestaña. */
export function preferServiceTools(tools: Tool[], servers: string[], apps: () => readonly WebApp[]) {
  const names = new Set(tools.map((t) => t.name));
  const search = names.has("mcp_search") && names.has("mcp_call");
  return tools.map((tool) => {
    if (tool.name !== "browser_open") return tool;
    const route = (args: Record<string, unknown>) => {
      if (args.purpose === "visual" || args.purpose === "unsupported") return;
      const pinned = typeof args.app === "string" ? apps().find((a) => a.id === args.app) : undefined;
      const url = typeof args.url === "string" ? args.url : pinned?.url;
      if (!url) return;
      const service = browserService(url)?.id;
      const associated =
        pinned && URL.parse(url)?.origin === URL.parse(pinned.url)?.origin ? webAppServer(pinned.id) : undefined;
      const server = search && (servers.find((s) => s === associated) ?? servers.find((s) => s === service));
      const native = service ? [...names].filter((n) => n.startsWith(service.replaceAll("-", "_") + "_")) : [];
      if (!server && !native.length) return;
      return [
        "Use the connected service for this operation and verify the requested account.",
        server && "Search this authorized connector: mcp_search server " + server,
        native.length && "Available tools: " + native.join(", "),
        "If no tool supports the operation, use purpose=unsupported. For a visual request use purpose=visual. A denied permission is final.",
      ]
        .filter(Boolean)
        .join(" ");
    };
    return {
      ...tool,
      title: (args: Record<string, unknown>) =>
        route(args) ? "Consultando los conectores disponibles" : tool.title(args),
      run: (args, ctx) => {
        const hint = route(args);
        return hint ? Promise.resolve(hint) : tool.run(args, ctx);
      },
    } satisfies Tool;
  });
}
