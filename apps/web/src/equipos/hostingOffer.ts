import { createStore, useSlice } from "../data/createStore.ts";

const offer = createStore<{ open: boolean; reminder?: boolean }>({ open: false });
const marker = "colonia.aviso-servidor-24h.v1";
let checking = false;
let offered = false;

export const useHostingOffer = () => useSlice(offer, (value) => value.open);
export const useHostingReminder = () => useSlice(offer, (value) => value.reminder === true);
export const closeHostingOffer = () => offer.set({ open: false, reminder: false });

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
    offer.set({ open: true, reminder: false });
  } catch {
    // El aviso es opcional. La automatización que la persona acaba de guardar sigue activa.
  } finally {
    checking = false;
  }
}

// RECORDATORIO-SERVIDOR-1 · Una vez cada 24 h (lo decide y lo guarda el núcleo: sobrevive a reinicios), si este
// Colonia no tiene servidor: notificación del sistema y el mismo aviso dentro del panel. Nunca el primer día.
let reminding = false;

/** Lleva a Mis equipos → «Colonia en un servidor». */
export async function goToHosting(): Promise<void> {
  const { go } = await import("../shell/nav.ts");
  go.view("equipos");
  go.focus("servidor-continuo");
}

export async function checkHostingReminder(text: { title: string; body: string }): Promise<void> {
  // Solo el panel del propio ordenador: el que ya está en un servidor no tiene nada que recordar.
  if (reminding || !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) return;
  reminding = true;
  try {
    const { client } = await import("../data/client.ts");
    if (!(await client.call("hosting.reminder", {})).due) return;
    await client.call("hosting.reminder_set", { action: "shown" });
    if (!offer.get().open) offer.set({ open: true, reminder: true });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const os = new Notification(text.title, { body: text.body, tag: "colonia-recordatorio-servidor", silent: true });
      os.onclick = () => {
        window.focus();
        closeHostingOffer();
        void goToHosting();
        os.close();
      };
    }
  } catch {
    // Un núcleo anterior sin el método o desconectado: no se recuerda nada.
  } finally {
    reminding = false;
  }
}

export async function stopHostingReminder(): Promise<void> {
  closeHostingOffer();
  try {
    const { client } = await import("../data/client.ts");
    await client.call("hosting.reminder_set", { action: "never" });
  } catch {}
}
