// Asked for something an app or channel the owner has not connected would do (a Figma file, a WhatsApp message), an
// agent offers to connect it instead of only saying it cannot: a card in the chat opens that one's form.
import type { ConnectOffer } from "@colonia/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { webAppServer } from "../rpc/webapps.ts";
import { defineTool, type Tool } from "./types.ts";

/** Offers on one card: the best few, not the catalog. */
const MAX_OFFERS = 3;

/** Where the owner connects it in the app, for a chat the card does not reach (a channel). */
const WHERE = { integration: "Resources › Integrations", channel: "Settings › Channels" } as const;

const named = (o: ConnectOffer) => `${o.label} (${o.kind}${o.coming ? ", coming soon" : ""})`;

export function connectionTools(store: Store): Tool[] {
  return [
    // WEBAPP-3: what the owner connected, internal (web apps pinned in Colonia) and external (connectors), in one look.
    defineTool({
      name: "list_apps",
      description:
        "The apps the owner connected to Colonia, so you use them instead of saying you cannot: their web apps (each opens with its own sign-in: browser_open with `app`; one with a connector also has tools) and their connectors (MCP servers: find their tools with mcp_search). Use it when asked about an app, an account or a service the owner works with.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the connected apps",
      async run() {
        const apps = store.settings.read("webapps");
        const servers = Object.keys(
          (JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: Record<string, unknown> })
            .mcpServers ?? {},
        );
        const own = new Set(apps.map((a) => webAppServer(a.id)));
        const web = apps.map(
          (a) =>
            `- ${a.name} (app: ${a.id}) · ${a.url}${servers.includes(webAppServer(a.id)) ? ` · connector: mcp_search server ${webAppServer(a.id)}` : ""}`,
        );
        const ext = servers.filter((s) => !own.has(s)).map((s) => `- ${s}`);
        return [
          `Web apps in Colonia (browser_open with app: <id>, signed in as the owner left them):\n${web.join("\n") || "- none"}`,
          `Connectors (mcp_search with server: <name>; one that is off or not signed in answers nothing):\n${ext.join("\n") || "- none"}`,
          "Not listed: suggest_connection offers to connect it.",
        ].join("\n\n");
      },
    }),
    defineTool({
      name: "suggest_connection",
      description:
        "When what the owner asks needs an app or channel that may not be connected (Figma, Notion, GitHub, WhatsApp, Telegram, email…): finds it and, if it is not connected, shows the owner a card to connect it. Use it instead of saying you cannot.",
      args: z.object({
        query: z.string().trim().min(1).max(200).describe("the app's or channel's name, or what it does, in English"),
        why: z.string().trim().max(200).optional().describe("one line for the owner: what you would do with it"),
      }),
      effect: "none",
      deadlineMs: 10_000,
      title: (a) => `Looked for ${String(a.query ?? "an app")} to connect`,
      async run(a, ctx) {
        const { found } = await ctx.call("integrations.find", { query: a.query });
        const top = found[0];
        if (!top)
          return `Nothing Colonia connects matches "${a.query}". Try the app's name; if it is none, tell the owner Colonia does not connect to it yet.`;
        if (top.connected) {
          const others = found.slice(1).map(named).join(", ");
          return `${named(top)} is already connected: use it.${others ? `\nAlso found: ${others}.` : ""}`;
        }
        const offers = found
          .filter((f) => !f.connected)
          .slice(0, MAX_OFFERS)
          .map(({ connected: _, ...o }) => o);
        const first = offers[0]?.id;
        // One card per suggestion: a second call in the same answer adds its own.
        ctx.upsertPart((p) => p.type === "connect" && p.offers[0]?.id === first, {
          type: "connect",
          ...(a.why ? { why: a.why } : {}),
          offers,
        });
        const where = [...new Set(offers.map((o) => WHERE[o.kind]))].join(" or ");
        const ready = found.filter((f) => f.connected).map(named);
        return `Shown to the owner as a card to connect: ${offers.map(named).join(", ")} (in the app: ${where}).${ready.length ? ` Already connected: ${ready.join(", ")}.` : ""} Say in a line what you would do once it is connected, and stop there: they tell you when it is.`;
      },
    }),
  ];
}
