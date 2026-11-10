// WEBAPP-1: the web apps the owner pins in the sidebar (Business Stack, a CRM…). Each opens inside Colonia in a tab
// with its own persistent sign-in (profile app:<id>), so the owner never leaves for the browser.
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function webAppHandlers(store: Store) {
  const list = () => store.settings.read("webapps");
  return {
    "webapps.list": () => ({ apps: list() }),
    "webapps.set": ({ id, app }) => {
      const now = list();
      const apps = !app
        ? now.filter((a) => a.id !== id)
        : now.some((a) => a.id === id)
          ? now.map((a) => (a.id === id ? { id, ...app } : a))
          : [...now, { id, ...app }];
      store.settings.write("webapps", apps);
      return { apps };
    },
  } satisfies Partial<Handlers>;
}
