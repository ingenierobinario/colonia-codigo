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
