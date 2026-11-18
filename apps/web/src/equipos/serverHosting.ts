import { LINKS } from "../data/links.ts";

export const RAILWAY_REFERRAL = "dBUtql";
const railwayId = /^[A-Za-z0-9_-]+$/;

/** Los identificadores públicos proceden de la plantilla y del enlace de invitación del editor. */
export function hostingLinks(language: string, template?: string, referral?: string) {
  const guide = new URL(language === "es" ? "es/docs/devices/server/" : "docs/devices/server/", LINKS.docs).href;
  const signup = new URL("https://railway.com/");
  const invitation = referral || RAILWAY_REFERRAL;
  const referred = railwayId.test(invitation);
  if (referred) signup.searchParams.set("referralCode", invitation);
  const deploy = template && railwayId.test(template) ? new URL(signup) : undefined;
  if (deploy) deploy.pathname = `/new/template/${template}`;
  return { guide, signup: signup.href, deploy: deploy?.href, referred };
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
