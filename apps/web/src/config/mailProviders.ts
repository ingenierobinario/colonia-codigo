// CANALES-SENCILLOS-2: a mailbox is set up from its address alone. The domain says whose servers it uses and where
// its app password is made; an unknown domain gets the names almost every host uses, shown under "More options".
import type { MailServer } from "@colonia/protocol";

/** Known providers: their servers, the address domains that point to them, and the page that makes an app password. */
export const PROVIDERS = {
  gmail: {
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.gmail.com", port: 465, tls: "implicit" },
    passwordPage: "https://myaccount.google.com/apppasswords",
  },
  outlook: {
    name: "Outlook",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    imap: { host: "outlook.office365.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.office365.com", port: 587, tls: "starttls" },
    passwordPage: "https://account.live.com/proofs/AppPassword",
  },
  icloud: {
    name: "iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: "starttls" },
    passwordPage: "https://account.apple.com/account/manage",
  },
  yahoo: {
    name: "Yahoo",
    domains: ["yahoo.com", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: "implicit" },
    passwordPage: "https://login.yahoo.com/myaccount/security/app-password",
  },
  fastmail: {
    name: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    imap: { host: "imap.fastmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.fastmail.com", port: 465, tls: "implicit" },
    passwordPage: "https://app.fastmail.com/settings/security/apps",
  },
} as const satisfies Record<
  string,
  { name: string; domains: string[]; imap: MailServer; smtp: MailServer; passwordPage: string }
>;
export type Provider = keyof typeof PROVIDERS | "other";

export const ADDRESS = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;

const domainOf = (address: string): string => address.split("@")[1]?.trim().toLowerCase() ?? "";

/** The provider an address belongs to, by its domain. */
export function providerOf(address: string): Provider | undefined {
  const domain = domainOf(address);
  const hit = Object.entries(PROVIDERS).find(([, p]) => (p.domains as readonly string[]).includes(domain));
  return hit?.[0] as Provider | undefined;
}

/** The servers of a domain nobody listed: the names most hosts give them, to be corrected if they differ. */
export function guessServers(address: string): { imap: MailServer; smtp: MailServer } | undefined {
  const domain = domainOf(address);
  if (!ADDRESS.test(address.trim()) || !domain) return undefined;
  return {
    imap: { host: `imap.${domain}`, port: 993, tls: "implicit" },
    smtp: { host: `smtp.${domain}`, port: 465, tls: "implicit" },
  };
}

/** Where the owner makes the app password of a mailbox, when its provider has a page for it. */
export function passwordPage(provider: Provider): { name: string; url: string } | undefined {
  if (provider === "other") return undefined;
  const p = PROVIDERS[provider];
  return { name: p.name, url: p.passwordPage };
}
