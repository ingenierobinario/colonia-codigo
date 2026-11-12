// CONTRASENAS-1: oferta «¿Guardar la contraseña?» que llega del proceso principal. El panel solo ve sitio y usuario.
import type { LoginOffer } from "../colonia-desktop.d.ts";
import { createStore, useSlice } from "./createStore.ts";

const store = createStore<{ offer?: LoginOffer; app?: string }>({});
export const useLoginOffer = (app: string): LoginOffer | undefined =>
  useSlice(store, (s) => (s.offer?.app === app ? s.offer : undefined));

let escuchando = false;
export function escucharOfertas(): void {
  const d = window.coloniaDesktop;
  if (escuchando || !d?.onLoginOffer) return;
  escuchando = true;
  d.onLoginOffer((offer) => store.set({ offer }));
}

export async function responderOferta(offer: LoginOffer, r: "guardar" | "nunca" | "ahora-no"): Promise<void> {
  store.set({ offer: undefined });
  await window.coloniaDesktop?.answerLoginOffer?.(offer.id, r);
}
