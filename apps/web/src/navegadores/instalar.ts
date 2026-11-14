// INSTALAR-NAV-1: what "+" under Navegadores offers besides the profiles found, and what the bar gains when a
// browser has just been installed. No React here, so it can be tested.
import type { Navegador } from "@colonia/protocol";
import type { BrowserInstallProgress, ImportSource } from "../colonia-desktop.d.ts";
import { BROWSER_NAMES, navegadorId } from "../data/navegador-names.ts";
import type { MessageKey } from "../i18n/index.ts";

export type Browser = keyof typeof BROWSER_NAMES;
const isBrowser = (id: string): id is Browser => Object.hasOwn(BROWSER_NAMES, id);

/** The folder a browser's first profile gets: the entry added before it has been opened keeps that id later. */
const FIRST_PROFILE = "Default";

/**
 * Installed browsers that have no profile to pick (never opened, or one whose profiles Colonia does not read) and
 * are not in the bar yet: "+" offers them as themselves.
 */
export function withoutProfile(
  installed: string[],
  sources: Pick<ImportSource, "navegador">[],
  navegadores: Pick<Navegador, "browser">[],
): Browser[] {
  const taken = new Set<string>([...sources.map((s) => s.navegador), ...navegadores.map((n) => n.browser)]);
  return (Object.keys(BROWSER_NAMES) as Browser[]).filter((b) => installed.includes(b) && !taken.has(b));
}

/**
 * What goes in the bar for a browser: each of its profiles found that is not there yet, or, when it has none to
 * read, one entry of its own (named `fallback`).
 */
export function entriesFor(
  browser: string,
  sources: ImportSource[],
  navegadores: Pick<Navegador, "id" | "browser">[],
  fallback: string,
): Navegador[] {
  if (!isBrowser(browser)) return [];
  const added = new Set(navegadores.map((n) => n.id));
  const mine = sources.filter((s) => s.navegador === browser);
  if (mine.length)
    return mine
      .map((s) => ({
        id: navegadorId(s.navegador, s.perfil),
        browser,
        name: s.nombre ?? s.perfil,
        ...(s.email ? { email: s.email } : {}),
      }))
      .filter((n) => !added.has(n.id));
  if (navegadores.some((n) => n.browser === browser)) return [];
  return [{ id: navegadorId(browser, FIRST_PROFILE), browser, name: fallback }];
}

export const installBusy = (p?: Pick<BrowserInstallProgress, "phase">): boolean =>
  !!p && p.phase !== "done" && p.phase !== "failed";

/** The line under the browser's name while it is being installed, and how it ended. */
export function installLine(p: Pick<BrowserInstallProgress, "phase" | "step" | "percent">): MessageKey {
  if (p.phase === "done") return "navegadores.installDone";
  if (p.phase === "failed") return "navegadores.installFailed";
  if (p.phase === "downloading")
    return p.percent == null ? "navegadores.installDownloading" : "navegadores.installDownloadingPct";
  if (p.phase === "waiting") {
    if (p.step === "dmg") return "navegadores.installWaitDmg";
    if (p.step === "package") return "navegadores.installWaitPackage";
    if (p.step === "page") return "navegadores.installWaitPage";
    return "navegadores.installWaitInstaller";
  }
  return "navegadores.installRunning";
}
