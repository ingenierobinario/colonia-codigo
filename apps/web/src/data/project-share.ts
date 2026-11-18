// PROYECTO-COMPARTIR-1 · Compartir un proyecto con otra persona: guardarlo en un fichero, pasar su código o publicarlo
// en un enlace; y traer el de otra persona. Nunca viajan claves, chats ni memoria: eso lo garantiza el core.
import type { Result } from "@colonia/protocol";
import { type MessageKey, t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { saveTextFile } from "./recipes.ts";

export type ProjectExport = Result<"projects.export">;
export type ProjectImport = Result<"projects.import">;

/** Un paquete es texto corto; algo mayor no lo es (el core pone el mismo tope). */
export const PACKAGE_FILE_MAX = 900_000;

export { canShareProject } from "./identity.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** El nombre del fichero que se guarda: el del proyecto, sin nada que un disco rechace. */
export const packageFileName = (name: string) =>
  `${
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "proyecto"
  }.colonia.json`;

/** Lo que la persona pegó: un enlace publicado, o el propio paquete (fichero o código). */
export function sourceOf(text: string): { link: string } | { content: string } | undefined {
  const value = text.trim();
  if (!value) return undefined;
  return /^https?:\/\/\S+$/i.test(value) ? { link: value } : { content: value };
}

/** Por qué no se pudo traer, dicho para quien no sabe qué es un paquete. */
export function importErrorKey(error: string): MessageKey {
  if (error.includes("not a Colonia project link")) return "pshare.err.link";
  if (error.includes("not a Colonia project")) return "pshare.err.foreign";
  if (error.includes("newer Colonia")) return "pshare.err.newer";
  if (error.includes("damaged")) return "pshare.err.damaged";
  if (error.includes("already a project named")) return "pshare.err.taken";
  if (error.includes("did not answer") || error.includes("no longer be published")) return "pshare.err.offline";
  if (error.includes("too large")) return "pshare.err.large";
  return "pshare.err.other";
}

/** Qué se compartiría de un proyecto, con el fichero y el código ya hechos. */
export async function exportProject(project: string): Promise<ProjectExport | undefined> {
  try {
    return await client.call("projects.export", { project });
  } catch (e) {
    const error = errText(e);
    notify(error.includes("too large") ? t("pshare.err.large") : t("pshare.err.export", { error }));
    return undefined;
  }
}

export function saveProjectFile(pkg: ProjectExport): void {
  saveTextFile(packageFileName(pkg.name), pkg.content);
  notify(t("pshare.saved", { name: pkg.name }), "info");
}

export async function copyText(text: string, done: MessageKey): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    notify(t(done), "info");
    return true;
  } catch {
    notify(t("share.copyFailed"));
    return false;
  }
}

/** Publica (o renueva) la copia del proyecto, o deja de publicarla. Devuelve la ruta del enlace mientras esté publicada. */
export async function publishProject(project: string, shared: boolean): Promise<{ path?: string } | undefined> {
  try {
    const r = await client.call("projects.share", { project, shared });
    return r.path ? { path: r.path } : {};
  } catch (e) {
    notify(t("pshare.err.export", { error: errText(e) }));
    return undefined;
  }
}

/** La dirección pública de este Colonia, si tiene una en marcha. */
export async function publicBase(): Promise<string | undefined> {
  try {
    const a = await client.call("webhooks.get", {});
    return a.url && a.mode !== "off" && !a.error ? a.url : undefined;
  } catch {
    return undefined;
  }
}

export type Address = Result<"webhooks.get">;

/** ENLACE-TEMPORAL-1 · Cuánto se espera al enlace temporal: la primera vez Colonia descarga la herramienta. */
export const TEMP_LINK_WAIT_MS = 4 * 60_000;

/** Cómo está la dirección pública ahora mismo, o nada si no se pudo preguntar. */
export async function readAddress(): Promise<Address | undefined> {
  try {
    return await client.call("webhooks.get", {});
  } catch {
    return undefined;
  }
}

/**
 * Abre el enlace temporal (Cloudflare, sin cuenta) y espera a que tenga dirección o diga por qué no. Devuelve el
 * último estado visto; `onStep` recibe cada uno para que el diálogo muestre que se está preparando.
 */
export async function openTempLink(
  onStep: (a: Address) => void,
  opts: { every?: number; waitMs?: number } = {},
): Promise<Address | undefined> {
  let a: Address;
  try {
    a = await client.call("webhooks.set", { mode: "cloudflare" });
  } catch {
    notify(t("hooks.err.cloudflare_download"));
    return undefined;
  }
  const end = Date.now() + (opts.waitMs ?? TEMP_LINK_WAIT_MS);
  for (;;) {
    onStep(a);
    if (a.mode !== "cloudflare" || (a.url && !a.error) || (a.error && !a.starting) || Date.now() > end) return a;
    await new Promise((r) => setTimeout(r, opts.every ?? 1500));
    a = (await readAddress()) ?? a;
  }
}

/** Cierra el enlace temporal (sólo si es el que está abierto: una dirección fija no se toca). */
export async function closeTempLink(): Promise<void> {
  const a = await readAddress();
  if (a?.mode !== "cloudflare") return;
  try {
    await client.call("webhooks.set", { mode: "off" });
  } catch {}
}

/**
 * ENLACE-TEMPORAL-2 · Deja de publicar un proyecto. El enlace temporal es de todos los publicados: sólo se cierra cuando
 * ya no queda ninguno (antes se cerraba siempre y los demás proyectos se quedaban sin enlace). Devuelve si se retiró.
 */
export async function unpublishProject(project: string): Promise<boolean> {
  let left: number | undefined;
  try {
    left = (await client.call("projects.share", { project, shared: false })).left;
  } catch (e) {
    notify(t("pshare.err.export", { error: errText(e) }));
    return false;
  }
  if (left === 0) await closeTempLink();
  return true;
}

type Source = { link: string } | { content: string };

/** Qué trae un paquete, sin guardar nada. */
export async function readProject(source: Source, name?: string): Promise<ProjectImport | undefined> {
  try {
    return await client.call("projects.import", { ...source, ...(name ? { name } : {}), save: false, replace: false });
  } catch (e) {
    const error = errText(e);
    notify(t(importErrorKey(error), { error }));
    return undefined;
  }
}

/** Lo guarda como proyecto de esta persona: nuevo, con otro nombre, o encima del que ya tenía con ese nombre. */
export async function importProject(source: Source, replace: boolean, name?: string) {
  try {
    const r = await client.call("projects.import", { ...source, ...(name ? { name } : {}), save: true, replace });
    return r.project ? { ...r, project: r.project } : undefined;
  } catch (e) {
    const error = errText(e);
    notify(t(importErrorKey(error), { error }));
    return undefined;
  }
}
