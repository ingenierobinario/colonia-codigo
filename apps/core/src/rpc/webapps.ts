// WEBAPP-1: the web apps the owner pins in the sidebar (Business Stack, a CRM…). Each opens inside Colonia in a tab
// with its own persistent sign-in (profile app:<id>), so the owner never leaves for the browser.
// WEBAPP-2: an app may bring its connector (an MCP address and, if it asks for one, a key). It becomes one of the
// owner's own MCP servers, named webapp-<id>, so every agent can use the app; the key is kept as a variable
// (secret://webapp-<id>) and only its reference is written into the server's definition.
import type { WebApp } from "@colonia/protocol";
import type { Store } from "../domain/store.ts";
import type { createMcp } from "../mcp/manager.ts";
import type { Secrets } from "../secrets.ts";
import type { Handlers } from "./router.ts";

type Mcp = Pick<ReturnType<typeof createMcp>, "config" | "drop">;

/** The server (and variable) name of an app's connector: within the 41 characters an MCP name takes. */
export const webAppServer = (id: string) => `webapp-${id}`.slice(0, 41).replace(/-+$/, "");

export function webAppHandlers(store: Store, mcp: Mcp, secrets: Pick<Secrets, "has" | "set">) {
  const list = () => store.settings.read("webapps");
  const keyed = (apps: readonly WebApp[]) =>
    apps.filter((a) => secrets.has(`secret://${webAppServer(a.id)}`)).map((a) => a.id);
  const connect = (id: string, app: WebApp | undefined) => {
    const name = webAppServer(id);
    if (!app?.mcp) {
      mcp.config.setGlobal(name, null);
      secrets.set(name, null);
    } else {
      const headers = secrets.has(`secret://${name}`) ? { Authorization: `Bearer secret://${name}` } : {};
      mcp.config.setGlobal(name, { url: app.mcp, headers });
    }
    mcp.drop({ scope: "global", name });
  };
  return {
    "webapps.list": () => {
      const apps = list();
      return { apps, keyed: keyed(apps) };
    },
    "webapps.set": ({ id, app, key }) => {
      const now = list();
      const next = app ? { id, ...app } : undefined;
      const apps = !next
        ? now.filter((a) => a.id !== id)
        : now.some((a) => a.id === id)
          ? now.map((a) => (a.id === id ? next : a))
          : [...now, next];
      if (key !== undefined) secrets.set(webAppServer(id), next?.mcp ? key : null);
      store.settings.write("webapps", apps);
      const before = now.find((a) => a.id === id);
      if (before?.mcp || next?.mcp) connect(id, next);
      return { apps, keyed: keyed(apps) };
    },
  } satisfies Partial<Handlers>;
}
