// PROYECTO-COMPARTIR-1 · Compartir un proyecto con otra persona que usa Colonia: exportarlo a un fichero, publicarlo
// en un enlace (la dirección pública que Colonia ya tiene) o pasarlo como un código, e importarlo desde cualquiera de
// los tres. El paquete lo arma domain/project-package.ts; aquí se lee y se escribe el disco.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withoutBom } from "../apc/read.ts";
import type { ApcSync } from "../apc/sync.ts";
import {
  connectionOf,
  FILE_MAX,
  PACKAGE_MAX,
  type PackageConnection,
  PROJECT_FORMAT,
  type ProjectPackage,
  packageCode,
  parsePackage,
  renderPackage,
  scrub,
  sensitiveFile,
  summaryOf,
} from "../domain/project-package.ts";
import { publicProject } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { writeAtomic } from "../paths.ts";
import { dropShared, putShared, sharedToken } from "../shared-projects.ts";
import { createProject } from "./app.ts";

/** Un enlace de proyecto publicado: la dirección pública de otro Colonia y `/p/<32 hex>`. */
const LINK_PATH = /^\/p\/[a-f0-9]{32}$/;
const LINK_DEADLINE_MS = 15_000;

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Un fichero de texto del proyecto, o nada: ni enlaces simbólicos, ni binarios, ni más de lo que cabe. */
function textOf(file: string): string | undefined {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > FILE_MAX) return undefined;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return undefined;
    return withoutBom(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Los ficheros de una carpeta, relativos y con «/», sin seguir enlaces simbólicos. */
function walk(dir: string, rel = "", out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink() || e.name === "node_modules") continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) out.push(r);
    if (out.length > 400) break;
  }
  return out;
}

export type Built = {
  pkg: ProjectPackage;
  /** Datos de acceso que se quitaron del texto. */
  removed: number;
  /** Ficheros que se dejaron fuera (credenciales, binarios, demasiado grandes). */
  skipped: number;
};

/** El proyecto de `root` como paquete. Solo lee lo que viaja: nunca la memoria, los chats ni los valores de nada. */
export function buildPackage(
  root: string,
  meta: { name: string; description?: string | undefined; kind?: ProjectPackage["project"]["kind"] | undefined },
  now: Date,
): Built {
  let removed = 0;
  let skipped = 0;
  const clean = (text: string) => {
    const c = scrub(text);
    removed += c.removed;
    return c.text;
  };
  const apc = path.join(root, ".apc");
  const inApc = !isLink(apc);
  const instructions = isLink(path.join(root, "AGENTS.md")) ? "" : clean(textOf(path.join(root, "AGENTS.md")) ?? "");

  const agents: ProjectPackage["agents"] = [];
  if (inApc && !isLink(path.join(apc, "agents")))
    for (const rel of walk(path.join(apc, "agents"))) {
      const slug = /^([a-z][a-z0-9_-]{0,80})\.md$/.exec(rel)?.[1];
      const text = slug ? textOf(path.join(apc, "agents", rel)) : undefined;
      if (slug && text !== undefined) agents.push({ slug, text: clean(text) });
      else skipped++;
    }

  const skills: ProjectPackage["skills"] = [];
  const skillsDir = path.join(apc, "skills");
  if (inApc && !isLink(skillsDir)) {
    let folders: fs.Dirent[] = [];
    try {
      folders = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {}
    for (const f of folders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!f.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(f.name)) continue;
      const files: { path: string; text: string }[] = [];
      for (const rel of walk(path.join(skillsDir, f.name))) {
        const ok = /^[A-Za-z0-9_][A-Za-z0-9._ -]*(\/[A-Za-z0-9_][A-Za-z0-9._ -]*)*$/.test(rel) && rel.length <= 200;
        const text =
          ok && !sensitiveFile(rel) && files.length < 60 ? textOf(path.join(skillsDir, f.name, rel)) : undefined;
        if (text === undefined) skipped++;
        else files.push({ path: rel, text: clean(text) });
      }
      if (files.some((x) => x.path === "SKILL.md")) skills.push({ folder: f.name, files });
    }
  }

  const connections: PackageConnection[] = [];
  const mcps = inApc && !isLink(path.join(apc, "mcps.json")) ? textOf(path.join(apc, "mcps.json")) : undefined;
  if (mcps) {
    try {
      const servers = (JSON.parse(mcps) as { mcpServers?: unknown }).mcpServers;
      if (servers && typeof servers === "object" && !Array.isArray(servers))
        for (const [name, raw] of Object.entries(servers)) {
          const c = connectionOf(name, raw);
          if (!c) continue;
          removed += c.removed;
          connections.push(c.connection);
        }
    } catch {}
  }

  let organization: ProjectPackage["organization"];
  const org =
    inApc && !isLink(path.join(apc, "organization.json")) ? textOf(path.join(apc, "organization.json")) : undefined;
  if (org) {
    try {
      const o = JSON.parse(clean(org)) as { areas?: unknown; roles?: unknown };
      const areas = Array.isArray(o.areas) ? o.areas.slice(0, 40) : [];
      const roles = Array.isArray(o.roles) ? o.roles.slice(0, 200) : [];
      if (areas.length + roles.length) organization = { areas, roles };
    } catch {}
  }

  const description = meta.description ? clean(meta.description).slice(0, 500) : "";
  return {
    pkg: {
      format: PROJECT_FORMAT,
      exported_at: now.toISOString(),
      project: {
        name: meta.name.slice(0, 80),
        ...(description ? { description } : {}),
        ...(meta.kind ? { kind: meta.kind } : {}),
      },
      instructions,
      ...(organization ? { organization } : {}),
      agents,
      skills,
      connections: connections.slice(0, 60),
    },
    removed,
    skipped,
  };
}

/** Escribe `rel` dentro de `root` sin atravesar un enlace simbólico en ningún tramo. */
function writeInside(root: string, rel: string, text: string): void {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++)
    if (isLink(path.join(root, ...parts.slice(0, i))))
      throw new Error(`refusing to write through a symlink: ${parts.slice(0, i).join("/")}`);
  const file = path.join(root, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, text);
}

/** Vuelca el paquete en la carpeta de un proyecto. Lo que ya había con otro nombre se queda como estaba. */
export function writePackage(root: string, pkg: ProjectPackage): void {
  writeInside(root, "AGENTS.md", pkg.instructions.trim() ? pkg.instructions : `# ${pkg.project.name}\n`);
  for (const a of pkg.agents) writeInside(root, `.apc/agents/${a.slug}.md`, a.text);
  for (const s of pkg.skills) for (const f of s.files) writeInside(root, `.apc/skills/${s.folder}/${f.path}`, f.text);
  if (pkg.organization) writeInside(root, ".apc/organization.json", `${JSON.stringify(pkg.organization, null, 2)}\n`);
  if (pkg.connections.length) {
    const file = path.join(root, ".apc", "mcps.json");
    let doc: Record<string, unknown> = {};
    try {
      if (!isLink(file)) doc = JSON.parse(withoutBom(fs.readFileSync(file, "utf8"))) as Record<string, unknown>;
    } catch {}
    const servers = { ...((doc.mcpServers as Record<string, unknown> | undefined) ?? {}) };
    // Cada dato que falta entra vacío: la conexión queda a la vista como «falta conectar» hasta que la persona lo rellena.
    const empty = (names: string[]) => Object.fromEntries(names.map((n) => [n, ""]));
    for (const c of pkg.connections)
      servers[c.name] = {
        ...(c.command ? { command: c.command, args: c.args } : { url: c.url }),
        ...(c.needs.length ? { env: empty(c.needs) } : {}),
        ...(c.headers.length ? { headers: empty(c.headers) } : {}),
      };
    writeInside(root, ".apc/mcps.json", `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`);
  }
}

/** Lo que una conexión importada necesita antes de funcionar. */
const pendingOf = (pkg: ProjectPackage) =>
  pkg.connections.map((c) => ({ name: c.name, needs: [...c.needs, ...c.headers], remote: !c.command }));

export type LinkFetch = (url: string, init: { redirect: "manual"; signal: AbortSignal }) => Promise<Response>;

/** Descarga el paquete de un enlace publicado: solo https, solo `/p/<enlace>`, sin redirecciones y con tope. */
export async function fetchPackage(link: string, fetchImpl: LinkFetch = fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw badRequest("this is not a Colonia project link");
  }
  if (url.protocol !== "https:" || url.username || url.password || !LINK_PATH.test(url.pathname))
    throw badRequest("this is not a Colonia project link");
  let res: Response;
  try {
    res = await fetchImpl(`${url.origin}${url.pathname}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_DEADLINE_MS),
    });
  } catch {
    throw badRequest("the link did not answer: the Colonia that published it may be off");
  }
  if (res.status !== 200) throw badRequest("the link did not answer: the project may no longer be published");
  const reader = res.body?.getReader();
  if (!reader) throw badRequest("the link did not answer: the project may no longer be published");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PACKAGE_MAX * 4) {
      await reader.cancel().catch(() => {});
      throw badRequest("this is not a Colonia project link");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const KINDS = ["personal", "app", "company", "software", "other"] as const;

export function projectShareHandlers(deps: {
  store: Store;
  home: string;
  apc: ApcSync;
  clock?: () => Date;
  /** Cómo se baja un enlace; las pruebas ponen el suyo. */
  fetch?: LinkFetch;
}) {
  const { store, home } = deps;
  const now = () => deps.clock?.() ?? new Date();
  const built = (id: string): Built & { id: string } => {
    const p = store.projects.get(id);
    if (!p) throw notFound(`project ${id}`);
    if (!p.path || !p.present) throw badRequest("this project has no folder on disk to share");
    const b = buildPackage(
      p.path,
      { name: p.name, description: p.description ?? undefined, kind: KINDS.find((k) => k === p.kind) },
      now(),
    );
    if (renderPackage(b.pkg).length > PACKAGE_MAX)
      throw badRequest("this project is too large to share: its skills hold more text than fits");
    return { ...b, id: p.id };
  };
  const linkOf = (id: string) => {
    const token = sharedToken(home, id);
    return token ? `/p/${token}` : undefined;
  };
  const refuse = (r: Exclude<ReturnType<typeof parsePackage>, { ok: true }>) =>
    r.why === "newer"
      ? badRequest("this project was shared from a newer Colonia; update Colonia to import it")
      : r.why === "broken"
        ? badRequest(`this Colonia project is damaged (${r.detail ?? "incomplete"})`)
        : badRequest("this is not a Colonia project");
  return {
    "projects.export": ({ project }: { project: string }) => {
      const b = built(project);
      const path_ = linkOf(b.id);
      return {
        ...summaryOf(b.pkg),
        content: renderPackage(b.pkg),
        code: packageCode(b.pkg),
        removed: b.removed,
        skipped: b.skipped,
        ...(path_ ? { path: path_ } : {}),
      };
    },
    "projects.share": ({ project, shared }: { project: string; shared: boolean }) => {
      if (!shared) {
        if (!store.projects.get(project)) throw notFound(`project ${project}`);
        dropShared(home, project);
        return { shared: false };
      }
      const b = built(project);
      // Publicar otra vez renueva la copia y conserva el enlace que ya se pasó.
      const token = sharedToken(home, b.id) ?? randomUUID().replaceAll("-", "");
      putShared(home, b.id, token, renderPackage(b.pkg));
      return { shared: true, path: `/p/${token}`, removed: b.removed };
    },
    "projects.import": async (p: {
      content?: string | undefined;
      link?: string | undefined;
      save: boolean;
      replace: boolean;
      name?: string | undefined;
    }) => {
      const text = p.link ? await fetchPackage(p.link, deps.fetch) : (p.content ?? "");
      const parsed = parsePackage(text);
      if (!parsed.ok) throw refuse(parsed);
      const pkg = p.name ? { ...parsed.pkg, project: { ...parsed.pkg.project, name: p.name } } : parsed.pkg;
      const same = store.projects.list().find((x) => x.name.toLowerCase() === pkg.project.name.toLowerCase());
      const said = { ...summaryOf(pkg), pending: pendingOf(pkg), taken: Boolean(same) };
      // Sin `save` no se toca nada: es la mirada previa, para que la persona vea qué trae antes de aceptarlo.
      if (!p.save) return { ...said, saved: false };
      if (same && !p.replace)
        throw badRequest(
          `there is already a project named ${pkg.project.name}; replace it or import it under another name`,
        );
      if (same && (!same.path || !same.present))
        throw badRequest(`the project named ${pkg.project.name} has no folder on disk; import it under another name`);
      let id: string;
      try {
        if (same?.path) {
          writePackage(same.path, pkg);
          id = same.id;
        } else {
          const made = createProject(deps.apc, home, {
            name: pkg.project.name,
            kind: pkg.project.kind,
            description: pkg.project.description,
          });
          id = made.project;
          const root = store.projects.get(id)?.path;
          if (!root) throw new Error("the project's folder could not be made");
          writePackage(root, pkg);
        }
        deps.apc.sync(id);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      const project = store.projects.get(id);
      if (!project) throw notFound(`project ${id}`);
      return { ...said, saved: true, project: publicProject(project) };
    },
  };
}
