// Where Colonia lives outside the app.
export const LINKS = {
  docs: "https://colonia.ingenierobinario.com/",
} as const;

/** The public site in the panel's language. */
export const guidesUrl = (lang: string): string => `${LINKS.docs}${lang === "es" ? "" : "en/"}`;

export const openLink = (url: string): void => void window.open(url, "_blank", "noopener,noreferrer");
