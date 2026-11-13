// EQUIPOS-ALIAS-1 · Lo poco que la barra lateral y la pantalla «Mis equipos» se dicen: a qué ficha ir, si se abre ya
// para cambiarle el nombre y que la lista ha cambiado (para no esperar al siguiente sondeo).
import { createStore, useSlice } from "../data/createStore.ts";

type Focus = { id: string; edit: boolean; n: number };
const store = createStore<{ focus?: Focus; changed: number }>({ changed: 0 });

export const useEquipoFocus = () => useSlice(store, (s) => s.focus);
export const useEquiposChanged = () => useSlice(store, (s) => s.changed);

/** Lleva a la ficha de un equipo; con `edit`, con el nombre ya listo para escribir. */
export const focusEquipo = (id: string, edit = false) =>
  store.set((s) => ({ focus: { id, edit, n: (s.focus?.n ?? 0) + 1 } }));

/** El nombre ya se guardó o se canceló: al volver a la pantalla no se reabre solo. */
export const editDone = () => store.set((s) => (s.focus?.edit ? { focus: { ...s.focus, edit: false } } : {}));

export const equiposChanged = () => store.set((s) => ({ changed: s.changed + 1 }));
