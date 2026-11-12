// ACCESOS-1: el contador de no leídos que se lee del título de la página de cada aplicación web, que es lo que
// esas webs actualizan sin pedir ningún permiso. Las fichas preconfiguradas del menú ya no existen.

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

// IMPORTAR-1: webs conocidas que se reconocen entre los marcadores y las más visitadas al importar.
type Conocida = { name: string; url: string; hosts: readonly string[] };
const CONOCIDAS: readonly Conocida[] = [
  { name: "Gmail", url: "https://mail.google.com/mail/u/0/", hosts: ["mail.google.com"] },
  { name: "Outlook", url: "https://outlook.office.com/mail/", hosts: ["outlook.office.com", "outlook.live.com"] },
  { name: "Microsoft Teams", url: "https://teams.microsoft.com", hosts: ["teams.microsoft.com", "teams.live.com"] },
  { name: "Slack", url: "https://app.slack.com/client", hosts: ["app.slack.com"] },
  { name: "Notion", url: "https://www.notion.so", hosts: ["www.notion.so", "notion.so"] },
  { name: "Google Calendar", url: "https://calendar.google.com", hosts: ["calendar.google.com"] },
  { name: "Google Drive", url: "https://drive.google.com", hosts: ["drive.google.com", "docs.google.com"] },
  { name: "WhatsApp", url: "https://web.whatsapp.com", hosts: ["web.whatsapp.com"] },
  { name: "LinkedIn", url: "https://www.linkedin.com", hosts: ["www.linkedin.com", "linkedin.com"] },
  { name: "Trello", url: "https://trello.com", hosts: ["trello.com"] },
  { name: "Asana", url: "https://app.asana.com", hosts: ["app.asana.com"] },
  { name: "GitHub", url: "https://github.com", hosts: ["github.com"] },
  { name: "Figma", url: "https://www.figma.com", hosts: ["www.figma.com", "figma.com"] },
  { name: "Canva", url: "https://www.canva.com", hosts: ["www.canva.com", "canva.com"] },
  { name: "Zoom", url: "https://app.zoom.us", hosts: ["app.zoom.us", "zoom.us"] },
];

export type WebReconocida = { name: string; url: string; origen: "marcador" | "visitada" };

/** Cruza marcadores y webs visitadas con las conocidas: una por web, los marcadores mandan sobre las visitas. */
export function reconocerWebs(
  marcadores: readonly { url: string }[],
  visitadas: readonly { host: string }[],
): WebReconocida[] {
  const out = new Map<string, WebReconocida>();
  const probar = (host: string, origen: WebReconocida["origen"]) => {
    const h = host.toLowerCase();
    const c = CONOCIDAS.find((k) => k.hosts.includes(h));
    if (c && !out.has(c.name)) out.set(c.name, { name: c.name, url: c.url, origen });
  };
  for (const m of marcadores) {
    try {
      probar(new URL(m.url).hostname, "marcador");
    } catch {
      /* marcador que no es una dirección web */
    }
  }
  for (const v of visitadas) probar(v.host, "visitada");
  return [...out.values()];
}
