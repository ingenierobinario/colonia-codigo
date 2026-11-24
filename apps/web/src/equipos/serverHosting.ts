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

const PENDING_KEY = "colonia.railway-pair";
const PENDING_MS = 24 * 60 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): Store | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

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

/** VINCULAR-CLAVE-1 · La clave que el servidor escribe en sus registros, tal como se copie: con guion, espacios o en minúsculas. */
export function pairKey(text: string): string | undefined {
  const code = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^[2-9A-HJ-NP-Z]{8}$/.test(code) ? code : undefined;
}

export type PairRefusal = "wrong" | "locked" | "expired" | "none" | "busy" | "unreachable" | "other";

/** Por qué no se pudo vincular, a partir del error del núcleo (su `detail.refused`). */
export function pairRefusal(err: unknown): PairRefusal {
  const why = (err as { detail?: { refused?: unknown } } | undefined)?.detail?.refused;
  return why === "wrong" ||
    why === "locked" ||
    why === "expired" ||
    why === "none" ||
    why === "busy" ||
    why === "unreachable"
    ? why
    : "other";
}
