// NAVEGADORES-1: the owner's browser profiles under Navegadores (Chrome · Work…). Each opens inside Colonia with its
// own tabs and its own persistent sign-in (profile nav:<id>); agents reach the same tabs through their tools.
import type { Navegador } from "@colonia/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { navegadores: Navegador[]; loaded: boolean };
const store = createStore<State>({ navegadores: [], loaded: false });
export const useNavegadores = <T>(select: (s: State) => T): T => useSlice(store, select);

export const BROWSER_NAMES = { chrome: "Chrome", edge: "Edge", brave: "Brave", firefox: "Firefox" } as const;
export const navProfile = (id: string) => `nav:${id}` as const;

/** "chrome", "Profile 1" → "chrome-profile-1": stable, so adding the same profile twice keeps one entry. */
export function navegadorId(browser: string, profile: string): string {
  return `${browser}-${profile}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function loadNavegadores(): Promise<void> {
  try {
    const { navegadores } = await client.call("navegadores.list", {});
    store.set({ navegadores, loaded: true });
  } catch {
    store.set({ loaded: true });
  }
}

export async function saveNavegador(id: string, navegador: Omit<Navegador, "id"> | null): Promise<boolean> {
  try {
    const { navegadores } = await client.call("navegadores.set", { id, navegador });
    store.set({ navegadores });
    return true;
  } catch (e) {
    notify(t("navegadores.saveError", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
