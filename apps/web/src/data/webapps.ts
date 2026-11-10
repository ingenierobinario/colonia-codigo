// WEBAPP-1: the web apps pinned in the sidebar (Business Stack, a CRM…), opened inside Colonia with their own sign-in.
import type { TabInfo, WebApp } from "@colonia/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

type State = { apps: WebApp[]; keyed: string[]; loaded: boolean };
const store = createStore<State>({ apps: [], keyed: [], loaded: false });
export const useWebApps = <T>(select: (s: State) => T): T => useSlice(store, select);

/** The tab profile of a web app: its sign-in lives there, apart from the agents' browser. */
export const webAppProfile = (id: string) => `app:${id}` as const;
export const isWebAppTab = (tab: TabInfo) => tab.profile.startsWith("app:");

export async function loadWebApps(): Promise<void> {
  try {
    const { apps, keyed } = await client.call("webapps.list", {});
    store.set({ apps, keyed, loaded: true });
  } catch {
    store.set({ loaded: true });
  }
}

/** "Business Stack" → "business-stack", made unique among the others. */
export function webAppId(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "app";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** key: a value saves the connector's key, null removes it, absent keeps it. */
export async function saveWebApp(id: string, app: Omit<WebApp, "id"> | null, key?: string | null): Promise<boolean> {
  try {
    const { apps, keyed } = await client.call("webapps.set", { id, app, ...(key !== undefined && { key }) });
    store.set({ apps, keyed });
    return true;
  } catch (e) {
    notify(t("webapp.saveError", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}

/** The tab already showing this app, or a new one opened on its address. */
export async function webAppTab(app: WebApp): Promise<string | undefined> {
  const profile = webAppProfile(app.id);
  const open = data.get().tabs.find((x) => x.profile === profile);
  if (open) return open.tab;
  try {
    const info = await client.call("browser.open", { url: app.url, profile, by: "operator" });
    data.set((s) => ({ tabs: [...s.tabs.filter((x) => x.tab !== info.tab), info] }));
    return info.tab;
  } catch (e) {
    notify(t("error.openTab", { error: e instanceof Error ? e.message : String(e) }));
    return undefined;
  }
}
