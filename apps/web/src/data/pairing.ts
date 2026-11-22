// The pairing gate: a core reachable from other devices asks for a token. A panel without one (or with a revoked one)
// shows "Pair this device" instead of the app, trades a one-time code for a device token and keeps it in this browser.
import { ColoniaClient } from "@colonia/protocol/client";
import { access, client, keyStore } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { needsPairing, osName, pairError, TOKEN_KEY } from "./token.ts";

export type Gate = "checking" | "open" | "pair";

const gate = createStore<{ gate: Gate }>({ gate: "checking" });

export const useGate = () => useSlice(gate, (s) => s.gate);

/** The core refused this panel: a stored token no longer works, so it goes, and the gate shows. */
export function denied(): void {
  if (access.from === "stored") {
    try {
      keyStore()?.removeItem(TOKEN_KEY);
    } catch {}
  }
  gate.set({ gate: "pair" });
}

/** One cheap call before the app starts: a refusal shows the gate; a core that is down shows the app (offline). */
export async function checkAccess(onGranted?: () => void): Promise<void> {
  try {
    await client.call("system.ping", {});
  } catch (e) {
    if (needsPairing(e)) denied();
    else gate.set({ gate: "open" });
    return;
  }
  onGranted?.();
  gate.set({ gate: "open" });
}

/** This device as the owner's list names it. */
export function thisDevice(browser: (os: string) => string, desktop: string) {
  if (window.coloniaDesktop) return { name: desktop, platform: "desktop" as const };
  return { name: browser(osName(navigator.userAgent) ?? "web"), platform: "other" as const };
}

/** Why pairing did not happen; `detail` is the core's own words for an unexpected failure. */
export type PairFailure = {
  why: ReturnType<typeof pairError> | "noStorage" | "ownerDenied" | "ownerUnavailable";
  detail?: string;
};

/** La clave del servidor autoriza únicamente la petición HTTP que abre una vinculación de un solo uso. */
export async function pairWithOwnerKey(
  key: string,
  device: { name: string; platform: "desktop" | "other" },
): Promise<PairFailure | undefined> {
  if (!window.isSecureContext || !key.trim()) return { why: "ownerDenied" };
  const owner = new ColoniaClient({ url: window.location.origin, token: key.trim() });
  try {
    const { code } = await owner.call("devices.pair_start", {});
    return await pairWith(code, device, !window.coloniaDesktop && location.protocol === "https:");
  } catch (error) {
    if (needsPairing(error)) return { why: "ownerDenied" };
    return { why: "ownerUnavailable" };
  }
}

/** Trades the code for this device's token, keeps it, and reloads with it; or says why not. */
export async function pairWith(
  code: string,
  device: { name: string; platform: "desktop" | "other" },
  hosting = false,
): Promise<PairFailure | undefined> {
  let token: string;
  try {
    ({ token } = await client.call("devices.pair", { code: code.trim(), ...device }));
  } catch (e) {
    return { why: pairError(e), detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    const store = keyStore();
    if (!store) return { why: "noStorage" };
    store.setItem(TOKEN_KEY, token);
  } catch {
    return { why: "noStorage" };
  }
  if (hosting) window.history.replaceState(null, "", "#view=equipos&host=welcome");
  window.location.reload();
  return undefined;
}

// PRECARGA-PAIR-1 · El código que vino en la dirección se guarda solo en memoria y se entrega una vez a la pantalla
// de emparejar: rellena el campo, pero vincular sigue siendo un clic del usuario.
let presetCode: string | undefined;

export function setPresetPairCode(code: string | undefined): void {
  presetCode = code;
}

export function takePresetPairCode(): string | undefined {
  const code = presetCode;
  presetCode = undefined;
  return code;
}
