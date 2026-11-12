// ACCESOS-1: aplicaciones web preconfiguradas (correo y mensajería con su interfaz oficial) y el contador de no
// leídos que se lee del título de la página, que es lo que esas webs actualizan sin pedir ningún permiso.
import type { WebApp } from "@colonia/protocol";

export type WebAppPreset = { key: string; name: string; url: string };

export const WEBAPP_PRESETS: readonly WebAppPreset[] = [
  { key: "gmail", name: "Gmail", url: "https://mail.google.com/mail/u/0/" },
  { key: "outlook", name: "Outlook", url: "https://outlook.office.com/mail/" },
  { key: "slack", name: "Slack", url: "https://app.slack.com/client" },
  { key: "teams", name: "Microsoft Teams", url: "https://teams.microsoft.com" },
];

/** El nombre de la ficha («Gmail»), para el aviso del sistema y la etiqueta de la barra. */
export const presetOf = (app: Pick<WebApp, "url">): WebAppPreset | undefined => {
  try {
    const host = new URL(app.url).hostname;
    return WEBAPP_PRESETS.find((p) => new URL(p.url).hostname === host);
  } catch {
    return undefined;
  }
};

const DRAFTS = /^(borradores|drafts)\b/i;
const LEADING = /^[([](\d{1,4})[)\]]/;
const ANYWHERE = /\((\d{1,4})\)/;
const SLACK = /\b(\d{1,4})\s+(?:new items?|elementos? nuevos?|nuevos? elementos?)/i;

/** Mensajes sin leer según el título de la pestaña: «Recibidos (3) - a@b.com - Gmail» → 3; sin cifra → 0. */
export function unreadFromTitle(title: string): number {
  const t = title.trim();
  if (!t || DRAFTS.test(t)) return 0; // en Gmail «Borradores (2)» cuenta borradores, no correo sin leer
  const m = LEADING.exec(t) ?? SLACK.exec(t) ?? ANYWHERE.exec(t);
  return m?.[1] ? Number(m[1]) : 0;
}
