// Where Colonia lives outside the app.
export const LINKS = {
  releases: "https://github.com/ingenierobinario/colonia/releases",
  docs: "https://colonia.ingenierobinario.com/",
} as const;

/** The public site in the panel's language. */
export const guidesUrl = (lang: string): string => `${LINKS.docs}${lang === "es" ? "" : "en/"}`;

export const openLink = (url: string): void => void window.open(url, "_blank", "noopener,noreferrer");
