import { LINKS } from "../data/links.ts";

const railwayId = /^[A-Za-z0-9_-]+$/;

/** Los identificadores públicos proceden de la plantilla y del enlace de invitación del editor. */
export function hostingLinks(language: string, template?: string, referral?: string) {
  const guide = new URL(language === "es" ? "es/docs/devices/server/" : "docs/devices/server/", LINKS.docs).href;
  if (!template || !railwayId.test(template)) return { guide, deploy: undefined, referred: false };

  const deploy = new URL(`https://railway.com/new/template/${template}`);
  const referred = Boolean(referral && railwayId.test(referral));
  if (referred && referral) deploy.searchParams.set("referralCode", referral);
  return { guide, deploy: deploy.href, referred };
}
