type Conocida = { service: string; name: string; url: string; hosts: readonly string[] };
const CONOCIDAS: readonly Conocida[] = [
  { service: "gmail", name: "Gmail", url: "https://mail.google.com/mail/u/0/", hosts: ["mail.google.com"] },
  {
    service: "microsoft-365",
    name: "Outlook",
    url: "https://outlook.office.com/mail/",
    hosts: ["outlook.office.com", "outlook.live.com"],
  },
  {
    service: "microsoft-365",
    name: "Microsoft Teams",
    url: "https://teams.microsoft.com",
    hosts: ["teams.microsoft.com", "teams.live.com"],
  },
  { service: "slack", name: "Slack", url: "https://app.slack.com/client", hosts: ["app.slack.com"] },
  { service: "notion", name: "Notion", url: "https://www.notion.so", hosts: ["www.notion.so", "notion.so"] },
  {
    service: "google-calendar",
    name: "Google Calendar",
    url: "https://calendar.google.com",
    hosts: ["calendar.google.com"],
  },
  {
    service: "google-drive",
    name: "Google Drive",
    url: "https://drive.google.com",
    hosts: ["drive.google.com", "docs.google.com"],
  },
  { service: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com", hosts: ["web.whatsapp.com"] },
  {
    service: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com",
    hosts: ["www.linkedin.com", "linkedin.com"],
  },
  { service: "trello", name: "Trello", url: "https://trello.com", hosts: ["trello.com"] },
  { service: "asana", name: "Asana", url: "https://app.asana.com", hosts: ["app.asana.com"] },
  { service: "github", name: "GitHub", url: "https://github.com", hosts: ["github.com"] },
  { service: "figma", name: "Figma", url: "https://www.figma.com", hosts: ["www.figma.com", "figma.com"] },
  { service: "canva", name: "Canva", url: "https://www.canva.com", hosts: ["www.canva.com", "canva.com"] },
  { service: "zoom", name: "Zoom", url: "https://app.zoom.us", hosts: ["app.zoom.us", "zoom.us"] },
];

export const knownSite = (hostname: string) => CONOCIDAS.find((site) => site.hosts.includes(hostname.toLowerCase()));
