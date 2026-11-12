// IMPORTAR-1: estado del asistente de importación (abierto o no) y si ya se ofreció en el primer uso.
import { createStore, useSlice } from "./createStore.ts";

const store = createStore<{ open: boolean }>({ open: false });
export const useMigrar = <T>(select: (s: { open: boolean }) => T): T => useSlice(store, select);
export const abrirAsistente = () => store.set({ open: true });
export const cerrarAsistente = () => store.set({ open: false });

const CLAVE = "colonia.importar.ofrecido";
export const yaOfrecido = (): boolean => {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return true;
  }
};
export const marcarOfrecido = (): void => {
  try {
    localStorage.setItem(CLAVE, "1");
  } catch {
    /* sin almacenamiento: no se vuelve a abrir solo en esta sesión */
  }
};
