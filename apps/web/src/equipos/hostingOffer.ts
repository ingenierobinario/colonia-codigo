import { createStore, useSlice } from "../data/createStore.ts";

const offer = createStore({ open: false });
const marker = "colonia.aviso-servidor-24h.v1";
let checking = false;
let offered = false;

export const useHostingOffer = () => useSlice(offer, (value) => value.open);
export const closeHostingOffer = () => offer.set({ open: false });

/** Electron distingue un motor del equipo de otro al que reenvía un puerto por SSH. */
export function isLocalHostingDesktop(coreLocal: boolean | undefined, hostname: string) {
  return coreLocal === true && ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}

/** Solo después de activar un trabajo y únicamente en el escritorio conectado a su motor local. */
export async function offerHostingAfterActivation(): Promise<void> {
  if (offered || checking || !isLocalHostingDesktop(window.coloniaDesktop?.coreLocal, location.hostname)) return;
  checking = true;
  try {
    const { client, keyStore } = await import("../data/client.ts");
    const storage = keyStore();
    if (storage?.getItem(marker) || (await client.call("sync.status", {})).paired) return;
    offered = true;
    storage?.setItem(marker, "1");
    offer.set({ open: true });
  } catch {
    // El aviso es opcional. La automatización que la persona acaba de guardar sigue activa.
  } finally {
    checking = false;
  }
}
