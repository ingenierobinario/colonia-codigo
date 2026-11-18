import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOrganization } from "../apc/org.ts";
import { INSTRUCTION_FILES, NATIVE_AGENT_APPS, withoutBom } from "../apc/read.ts";
import { sensitiveFile } from "../domain/project-file-name.ts";
import { connectionOf } from "../domain/project-package.ts";
import { isInside, real, realpath, samePath } from "../paths.ts";
import { APPS } from "../skills/skills.ts";
import type { ArchiveWriter } from "./archive.ts";
import { type FileEntry, walkFiles } from "./inventory.ts";

const native = [
  ".apc/agents",
  ".apc/skills",
  ".apc/tasks",
  ".apc/routines",
  ".apc/roles",
  ".apc/areas",
  ".cursor/rules",
  ...NATIVE_AGENT_APPS.map((app) => `.${app}/agents`),
  ...APPS.map((app) => `.${app}/skills`),
  ".github",
];
const single = new Set<string>([
  ...INSTRUCTION_FILES,
  ".apc/memory.md",
  ".apc/organization.json",
  ".apc/mcps.json",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".dockerignore",
]);

function allowed(rel: string, directory: boolean): boolean {
  const parts = rel.split("/");
  if (
    !parts.every(
      (part) =>
        part &&
        !/[\p{Cc}<>:"\\|?*]/u.test(part) &&
        !/[. ]$/.test(part) &&
        !/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part),
    )
  )
    return false;
  if (
    parts.some((p) =>
      /^(?:node_modules|login data(?:-.*)?|web data(?:-.*)?|local state|logins\.json|keychain|auth\.json)$/i.test(p),
    ) ||
    /\.(?:colonia(?:\.parcial)?)$/i.test(rel)
  )
    return false;
  if (single.has(rel)) return !directory;
  if (directory && [...native, ...single].some((prefix) => prefix === rel || prefix.startsWith(`${rel}/`))) return true;
  const prefix = native.find((folder) => rel.startsWith(`${folder}/`));
  const body = prefix ? rel.slice(prefix.length + 1) : rel;
  return body.split("/").every((part) => !sensitiveFile(part));
}

/** Misma regla para los archivos de trabajo que salen y para los que entran en una carpeta nueva. */
export function projectFileAllowed(rel: string): boolean {
  return allowed(rel, false);
}

const definition = (rel: string) => rel === ".apc/organization.json" || rel === ".apc/mcps.json";
const DEFINITION_MAX = 2 * 1024 * 1024;
export type ProjectFileEntry = FileEntry & { archiveBytes?: number; definition?: Buffer };

/** Reconstruye las declaraciones de las áreas y de los conectores sin datos de acceso del equipo de origen. */
export function cleanProjectDefinition(rel: string, bytes: Buffer): Buffer | undefined {
  if (!definition(rel)) return undefined;
  if (bytes.length > DEFINITION_MAX) throw new Error("La definición de proyecto supera los 2 MiB.");
  const text = withoutBom(bytes.toString("utf8"));
  if (rel === ".apc/organization.json") return Buffer.from(JSON.stringify(parseOrganization(text)), "utf8");
  const servers: unknown = JSON.parse(text)?.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers)))
    throw new Error("El archivo de conectores del proyecto tiene un formato desconocido.");
  const empty = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, ""]));
  const portable = Object.create(null) as Record<string, unknown>;
  for (const [key, raw] of Object.entries(servers ?? {})) {
    const c = connectionOf(key, raw)?.connection;
    if (c)
      portable[c.name] = {
        ...(c.command ? { command: c.command, args: c.args } : { url: c.url }),
        ...(c.needs.length ? { env: empty(c.needs) } : {}),
        ...(c.headers.length ? { headers: empty(c.headers) } : {}),
      };
  }
  return Buffer.from(JSON.stringify({ mcpServers: portable }), "utf8");
}

function verifyFile(fd: number, entry: FileEntry) {
  const st = fs.fstatSync(fd, { bigint: true });
  const current = fs.lstatSync(entry.abs, { bigint: true });
  if (
    !st.isFile() ||
    st.nlink !== 1n ||
    st.size !== BigInt(entry.size) ||
    st.dev !== current.dev ||
    st.ino !== current.ino ||
    !current.isFile() ||
    !samePath(realpath(entry.abs), entry.abs)
  )
    throw new Error("El archivo del proyecto cambió durante la copia.");
}

function prepareDefinition(entry: FileEntry): ProjectFileEntry {
  if (!definition(entry.rel)) return entry;
  if (entry.size > DEFINITION_MAX) throw new Error("La definición de proyecto supera los 2 MiB.");
  const fd = fs.openSync(entry.abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    verifyFile(fd, entry);
    const bytes = Buffer.alloc(entry.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("La definición cambió durante la copia.");
      offset += count;
    }
    const data = cleanProjectDefinition(entry.rel, bytes);
    if (!data) throw new Error("Definición de proyecto desconocida.");
    return { ...entry, definition: data, archiveBytes: data.length };
  } finally {
    fs.closeSync(fd);
  }
}

/** Excluye la instalación, los proyectos anidados y los enlaces antes de recorrer cada subcarpeta. */
export async function projectFiles(
  root: string,
  home: string,
  otherProjectRoots: readonly string[],
): Promise<ProjectFileEntry[]> {
  if (!path.isAbsolute(root) || !fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("No se puede abrir la carpeta de este proyecto.");
  }
  const base = realpath(root);
  const installation = real(home);
  if (isInside(base, installation) || isInside(base, real(os.homedir()))) {
    throw new Error("Selecciona la carpeta concreta que pertenece al proyecto.");
  }
  const reserved = new Set<string>();
  for (const other of otherProjectRoots.filter((value) => path.isAbsolute(value))) {
    const at = real(other);
    if (samePath(base, at)) throw new Error("Esta carpeta pertenece también a otro proyecto.");
    if (isInside(base, at))
      reserved.add(path.relative(base, at).split(path.sep).join("/").normalize("NFC").toLowerCase());
  }
  const entries = await walkFiles(
    base,
    "",
    (rel, entry) => reserved.has(rel.normalize("NFC").toLowerCase()) || !allowed(rel, entry.isDirectory()),
    [],
    true,
  );
  return entries.map(prepareDefinition);
}

/** La comprobación usa el descriptor que el escritor leerá, incluso si una carpeta cambia durante el inventario. */
export function addProjectFile(
  writer: ArchiveWriter,
  name: string,
  root: string,
  entry: ProjectFileEntry,
): Promise<void> {
  const actual = path.resolve(real(root), entry.rel);
  if (!projectFileAllowed(entry.rel) || !samePath(actual, entry.abs))
    throw new Error("El archivo no pertenece a la carpeta del proyecto.");
  if (definition(entry.rel)) {
    if (!entry.definition || entry.definition.length !== entry.archiveBytes)
      throw new Error("Falta la definición preparada del proyecto.");
    return writer.add(name, entry.definition);
  }
  return writer.addFile(name, entry.abs, (fd) => verifyFile(fd, entry));
}
