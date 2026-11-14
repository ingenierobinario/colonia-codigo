// NAVEGADORES-1: what each browser is called and the id of one of its profiles. No client here (INSTALAR-NAV-1).
export const BROWSER_NAMES = {
  chrome: "Chrome",
  edge: "Edge",
  brave: "Brave",
  firefox: "Firefox",
  // INSTALAR-NAV-1
  opera: "Opera",
  vivaldi: "Vivaldi",
  safari: "Safari",
} as const;

/** "chrome", "Profile 1" → "chrome-profile-1": stable, so adding the same profile twice keeps one entry. */
export function navegadorId(browser: string, profile: string): string {
  return `${browser}-${profile}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
