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

// INSTALAR-NAV-1: the names and the id live apart, free of the client, so what uses them can be tested.
export { BROWSER_NAMES, navegadorId } from "./navegador-names.ts";
export const navProfile = (id: string) => `nav:${id}` as const;

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

/** INSTALAR-NAV-1: the list as it is right now, for code that runs after a wait. */
export const currentNavegadores = (): Navegador[] => store.get().navegadores;
