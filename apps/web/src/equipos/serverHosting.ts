import { LINKS } from "../data/links.ts";
import { releaseBefore } from "../data/release.ts";

export const RAILWAY_REFERRAL = "dBUtql";
const railwayId = /^[A-Za-z0-9_-]+$/;

/** Los identificadores públicos proceden de la plantilla y del enlace de invitación del editor. */
export function hostingLinks(language: string, template?: string, referral?: string, version?: string) {
  const guide = new URL(language === "es" ? "es/docs/devices/server/" : "docs/devices/server/", LINKS.docs).href;
  const signup = new URL("https://railway.com/");
  const invitation = referral || RAILWAY_REFERRAL;
  const referred = railwayId.test(invitation);
  if (referred) signup.searchParams.set("referralCode", invitation);
  const deploy = template && railwayId.test(template) ? new URL(signup) : undefined;
  if (deploy) deploy.pathname = `/new/template/${template}`;
  // El ZIP comenzó a distribuirse con la 2.36.51. Las compilaciones de desarrollo consultan el catálogo público.
  const download = releaseBefore("2.36.50", version ?? "");
  const files = {
    download,
    url: download ? `${LINKS.releases}/download/v${version}/colonia-railway-${version}.zip` : LINKS.releases,
  };
  return { guide, signup: signup.href, deploy: deploy?.href, referred, files };
}

/** Invitación efímera para el escritorio. La dirección y el código viajan separados. */
export function cloudInvitation(text: string): { address: string; code: string } | undefined {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 2) return undefined;
  const [raw, value] = parts;
  if (!raw || !value) return undefined;
  const code = value.toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}$/.test(code)) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      return undefined;
    return { address: url.origin, code };
  } catch {
    return undefined;
  }
}

// AUTOVINCULAR-1 · El escritorio inventa el código y lo manda a la plantilla de Railway como variable precargada
// (`?COLONIA_PAIR_CODE=…`). El servidor arranca enseñándolo y solo hace falta su dirección para vincularse.
const PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIR_VARIABLE = "COLONIA_PAIR_CODE";
const PENDING_KEY = "colonia.railway-pair";
const PENDING_MS = 24 * 60 * 60_000;

/** Ocho caracteres del mismo alfabeto que el núcleo; 32 es divisor de 256, así que no hay sesgo. */
export function newPairCode(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  return Array.from(random(new Uint8Array(8)), (n) => PAIR_ALPHABET[n % 32]).join("");
}

export function withPairCode(deploy: string, code: string): string {
  const url = new URL(deploy);
  url.searchParams.set(PAIR_VARIABLE, code);
  return url.href;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): Store | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function rememberPairCode(code: string, store = storage(), now = Date.now()): void {
  try {
    store?.setItem(PENDING_KEY, JSON.stringify({ code, at: now }));
  } catch {}
}

export function pendingPairCode(store = storage(), now = Date.now()): string | undefined {
  try {
    const raw = store?.getItem(PENDING_KEY);
    if (!raw) return undefined;
    const { code, at } = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof code === "string" && /^[2-9A-HJ-NP-Z]{8}$/.test(code) && typeof at === "number" && now - at < PENDING_MS)
      return code;
    store?.removeItem(PENDING_KEY);
  } catch {}
  return undefined;
}

export function forgetPairCode(store = storage()): void {
  try {
    store?.removeItem(PENDING_KEY);
  } catch {}
}

/** La dirección pública del servidor tal como se copie de Railway: con o sin `https://`, con o sin barra final. */
export function serverAddress(text: string): string | undefined {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
