// PROYECTO-COMPARTIR-1 · Compartir un proyecto con otra persona que usa Colonia: exportarlo a un fichero, publicarlo
// en un enlace (la dirección pública que Colonia ya tiene) o pasarlo como un código, e importarlo desde cualquiera de
// los tres. El paquete lo arma domain/project-package.ts; aquí se lee y se escribe el disco.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import { NATIVE_AGENT_APPS, projectInstructions, withoutBom } from "../apc/read.ts";
import type { ApcSync } from "../apc/sync.ts";
import { checkKnown, knownProjects } from "../domain/project-links.ts";
import {
  connectionOf,
  FILE_MAX,
  knownNames,
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
  withKnown,
} from "../domain/project-package.ts";
import { publicProject } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { writeAtomic } from "../paths.ts";
import { dropShared, putShared, sharedIndex, sharedToken } from "../shared-projects.ts";
import { allSkills, type Skill, type SkillRoots } from "../skills/skills.ts";
import { createProject } from "./app.ts";

/**
 * PROYECTOS-ENLAZADOS-1 · Los nombres de proyectos conocidos que trae un paquete, buscados aquí: los que existen (y
 * se pueden enlazar sin cerrar un bucle) y los que no. Los que este proyecto ya conocía se conservan.
 */
function resolveKnown(store: Store, own: string, names: string[]): { found: string[]; missing: string[] } {
  const found = [...(store.projects.get(own)?.knows ?? [])];
  const missing: string[] = [];
  const all = store.projects.list();
  for (const name of names) {
    const match = all.find((p) => p.id !== own && p.name.toLowerCase() === name.toLowerCase());
    try {
      if (!match) throw new Error("none");
      if (!found.includes(match.id)) found.push(...checkKnown(store, own, [match.id]));
    } catch {
      missing.push(name);
    }
  }
  return { found: found.slice(0, 16), missing };
}

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

export type RemovedIn = {
  kind: "description" | "instructions" | "agent" | "skill" | "connection" | "organization";
  name: string;
  count: number;
};

export type Built = {
  pkg: ProjectPackage;
  /** Datos de acceso que se quitaron del texto. */
  removed: number;
  /** AVISO-QUITADOS-1 · En qué parte del proyecto se quitó cada uno, para que la persona sepa dónde mirar. */
  removedIn: RemovedIn[];
  /** Ficheros que se dejaron fuera (credenciales, binarios, demasiado grandes). */
  skipped: number;
};

const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * SKILLS-VIAJAN-1 · Las skills que el proyecto usa, en minúsculas: las que un agente pide en su `skills:` y las que
 * las instrucciones o el texto de un agente nombran («usa la skill holcim-interface-tracker»). Un nombre corto o de
 * una sola palabra común no cuenta por aparecer en el texto: solo si lleva guion, punto o barra baja, o va tras «skill».
 */
export function usedSkillNames(names: string[], texts: string[]): Set<string> {
  const used = new Set<string>();
  const listed = texts.flatMap((t) => {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
    const line = /^skills\s*:\s*(.*)$/im.exec(fm);
    if (!line) return [];
    const rest = fm.slice(fm.indexOf(line[0]) + line[0].length);
    const items = (line[1] ?? "").replace(/^\[|\]$/g, "").split(",");
    for (const m of rest.matchAll(/^\s*-\s*(.+)$/gm)) items.push(m[1] ?? "");
    return items
      .map((x) =>
        x
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase(),
      )
      .filter(Boolean);
  });
  const all = texts.join("\n").toLowerCase();
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (listed.includes(name)) {
      used.add(name);
      continue;
    }
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = new RegExp(`(?<![a-z0-9_.-])${esc}(?![a-z0-9_-])`);
    const named = new RegExp(`skills?\\W{1,3}${esc}(?![a-z0-9_-])|${esc}\\W{1,3}skill`);
    if ((/[-_.]/.test(name) && name.length >= 4 && word.test(all)) || named.test(all)) used.add(name);
  }
  return used;
}

/** El proyecto de `root` como paquete. Solo lee lo que viaja: nunca la memoria, los chats ni los valores de nada. */
export function buildPackage(
  root: string,
  meta: { name: string; description?: string | undefined; kind?: ProjectPackage["project"]["kind"] | undefined },
  now: Date,
  /** SKILLS-VIAJAN-1 · Las skills que ve el proyecto (allSkills): de aquí salen las de otras carpetas y las globales que usa. */
  visible?: Skill[],
): Built {
  let removed = 0;
  let skipped = 0;
  const removedIn: RemovedIn[] = [];
  const took = (kind: RemovedIn["kind"], name: string, count: number) => {
    if (count <= 0) return;
    removed += count;
    const same = removedIn.find((r) => r.kind === kind && r.name === name);
    if (same) same.count += count;
    else removedIn.push({ kind, name, count });
  };
  const clean = (text: string, kind: RemovedIn["kind"], name = "") => {
    const c = scrub(text);
    took(kind, name, c.removed);
    return c.text;
  };
  const apc = path.join(root, ".apc");
  const inApc = !isLink(apc);
  const fileText = (name: string) => (isLink(path.join(root, name)) ? undefined : textOf(path.join(root, name)));
  // AGENTES-NATIVOS-1 · El CLAUDE.md viaja dentro de las instrucciones: quien importa solo recibe AGENTS.md.
  const instructions = clean(
    projectInstructions((f) => (isLink(path.join(root, path.dirname(f))) ? undefined : fileText(f))) ?? "",
    "instructions",
  );

  // Los de `.apc/agents` y, con el slug libre, los de `.claude/agents`, `.codex/agents` y `.agents/agents`.
  const agents: ProjectPackage["agents"] = [];
  const agentDirs = [
    ...(inApc ? [path.join(apc, "agents")] : []),
    ...NATIVE_AGENT_APPS.filter((app) => !isLink(path.join(root, `.${app}`))).map((app) =>
      path.join(root, `.${app}`, "agents"),
    ),
  ];
  for (const dir of agentDirs) {
    if (isLink(dir)) continue;
    for (const rel of walk(dir)) {
      const slug = /^([a-z][a-z0-9_-]{0,80})\.md$/.exec(rel)?.[1];
      if (slug && agents.some((a) => a.slug === slug)) continue;
      const text = slug ? textOf(path.join(dir, rel)) : undefined;
      if (slug && text !== undefined) agents.push({ slug, text: clean(text, "agent", slug) });
      else if (dir === path.join(apc, "agents")) skipped++;
    }
  }

  // SKILLS-VIAJAN-1 · Una skill viaja con sus ficheros: las del proyecto (`.apc/skills`, y en su sitio `.claude/skills`…)
  // y las globales que el proyecto usa. Sin la lista de skills visibles (pruebas antiguas), solo `.apc/skills`.
  const skills: ProjectPackage["skills"] = [];
  const pack = (folder: string, dir: string, allowLink = false) => {
    if (!FOLDER_RE.test(folder) || skills.some((s) => s.folder === folder) || (!allowLink && isLink(dir))) return;
    const files: { path: string; text: string }[] = [];
    for (const rel of walk(dir)) {
      const ok = /^[A-Za-z0-9_][A-Za-z0-9._ -]*(\/[A-Za-z0-9_][A-Za-z0-9._ -]*)*$/.test(rel) && rel.length <= 200;
      const text = ok && !sensitiveFile(rel) && files.length < 60 ? textOf(path.join(dir, rel)) : undefined;
      if (text === undefined) skipped++;
      else files.push({ path: rel, text: clean(text, "skill", folder) });
    }
    if (files.some((x) => x.path === "SKILL.md")) skills.push({ folder, files });
  };
  const skillsDir = path.join(apc, "skills");
  if (inApc && !isLink(skillsDir)) {
    let folders: fs.Dirent[] = [];
    try {
      folders = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {}
    for (const f of folders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
      if (f.isDirectory()) pack(f.name, path.join(skillsDir, f.name));
  }
  if (visible) {
    const used = usedSkillNames(
      visible.filter((s) => s.source !== "colonia").map((s) => s.name),
      [instructions, ...agents.map((a) => a.text)],
    );
    for (const s of visible) {
      if (s.source === "colonia" || (s.scope !== "project" && !used.has(s.name.toLowerCase()))) continue;
      const folder = FOLDER_RE.test(s.name) ? s.name : path.basename(s.dir);
      pack(folder, s.dir, s.scope === "global");
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
          took("connection", name.slice(0, 80), c.removed);
          connections.push(c.connection);
        }
    } catch {}
  }

  let organization: ProjectPackage["organization"];
  const org =
    inApc && !isLink(path.join(apc, "organization.json")) ? textOf(path.join(apc, "organization.json")) : undefined;
  if (org) {
    try {
      const o = JSON.parse(clean(org, "organization")) as { areas?: unknown; roles?: unknown };
      const areas = Array.isArray(o.areas) ? o.areas.slice(0, 40) : [];
      const roles = Array.isArray(o.roles) ? o.roles.slice(0, 200) : [];
      if (areas.length + roles.length) organization = { areas, roles };
    } catch {}
  }

  const description = meta.description ? clean(meta.description, "description").slice(0, 500) : "";
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
    removedIn,
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
export function writePackage(root: string, pkg: ProjectPackage, skipSkills: ReadonlySet<string> = new Set()): string[] {
  const kept: string[] = [];
  writeInside(root, "AGENTS.md", pkg.instructions.trim() ? pkg.instructions : `# ${pkg.project.name}\n`);
  for (const a of pkg.agents) writeInside(root, `.apc/agents/${a.slug}.md`, a.text);
  for (const s of pkg.skills)
    if (!skipSkills.has(s.folder))
      for (const f of s.files) writeInside(root, `.apc/skills/${s.folder}/${f.path}`, f.text);
  // Los enlaces (`knows`) no son del organigrama: se resuelven al importar y nunca llegan a este fichero.
  const { areas = [], roles = [] } = pkg.organization ?? {};
  if (areas.length + roles.length)
    writeInside(root, ".apc/organization.json", `${JSON.stringify({ areas, roles }, null, 2)}\n`);
  if (pkg.connections.length) {
    const file = path.join(root, ".apc", "mcps.json");
    let doc: Record<string, unknown> = {};
    try {
      if (!isLink(file)) doc = JSON.parse(withoutBom(fs.readFileSync(file, "utf8"))) as Record<string, unknown>;
    } catch {}
    const servers = { ...((doc.mcpServers as Record<string, unknown> | undefined) ?? {}) };
    // Cada dato que falta entra vacío: la conexión queda a la vista como «falta conectar» hasta que la persona lo rellena.
    const empty = (names: string[]) => Object.fromEntries(names.map((n) => [n, ""]));
    // CLAVES-PROPIAS-1 · Al reemplazar un proyecto que ya se tenía, la conexión que sigue siendo la misma (mismo
    // comando y argumentos, o misma dirección) conserva los datos que la persona puso; si el servidor cambió, entran
    // vacíos, porque esos datos se dieron a otro servidor.
    const values = (before: unknown, names: string[]) => {
      const old =
        before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
      return Object.fromEntries(names.map((n) => [n, typeof old[n] === "string" ? (old[n] as string) : ""]));
    };
    for (const c of pkg.connections) {
      const server = c.command ? { command: c.command, args: c.args } : { url: c.url };
      const before = servers[c.name];
      const old =
        before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
      const same =
        JSON.stringify(c.command ? { command: old.command, args: old.args ?? [] } : { url: old.url }) ===
        JSON.stringify(server);
      const env = same ? values(old.env, c.needs) : empty(c.needs);
      const headers = same ? values(old.headers, c.headers) : empty(c.headers);
      servers[c.name] = {
        ...server,
        ...(c.needs.length ? { env } : {}),
        ...(c.headers.length ? { headers } : {}),
      };
      const filled = [...Object.values(env), ...Object.values(headers)];
      if (same && filled.length > 0 && filled.every((v) => v !== "")) kept.push(c.name);
    }
    writeInside(root, ".apc/mcps.json", `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`);
  }
  return kept;
}

/** El nombre de una skill del paquete: el `name:` de su SKILL.md, o su carpeta. */
const skillNameOf = (s: ProjectPackage["skills"][number]) => {
  const md = s.files.find((f) => f.path === "SKILL.md")?.text ?? "";
  try {
    return textField(parseFrontmatter(md).fields.name) ?? s.folder;
  } catch {
    return s.folder;
  }
};

export type SkillConflict = { name: string; reason: "different" | "reserved" };

/**
 * SKILLS-VIAJAN-1 · Qué skills del paquete NO se escriben en el proyecto de destino, porque pisarían una que ya está:
 * una con ese nombre que se ve desde ahí (global, de otra app o del proyecto) y dice otra cosa es un conflicto
 * declarado; si dice lo mismo, ya está y no hace falta. Solo la propia `.apc/skills/<carpeta>` del proyecto que se
 * reemplaza se sobrescribe, como siempre.
 */
export function skillPlan(
  pkg: ProjectPackage,
  root: string,
  visible: Skill[],
): { skip: Set<string>; conflicts: SkillConflict[]; same: string[] } {
  const skip = new Set<string>();
  const conflicts: SkillConflict[] = [];
  const same: string[] = [];
  const own = (dir: string, folder: string) => path.resolve(dir) === path.resolve(root, ".apc", "skills", folder);
  for (const s of pkg.skills) {
    const name = skillNameOf(s);
    const there = visible.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (!there || own(there.dir, s.folder)) continue;
    skip.add(s.folder);
    if (there.source === "colonia") {
      conflicts.push({ name, reason: "reserved" });
      continue;
    }
    let mine: string | undefined;
    try {
      mine = withoutBom(fs.readFileSync(path.join(there.dir, "SKILL.md"), "utf8"));
    } catch {}
    const theirs = s.files.find((f) => f.path === "SKILL.md")?.text;
    if (mine !== undefined && mine.replace(/\r\n/g, "\n") === theirs?.replace(/\r\n/g, "\n")) same.push(name);
    else conflicts.push({ name, reason: "different" });
  }
  return { skip, conflicts, same };
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
  /** SKILLS-VIAJAN-1 · Dónde se buscan las skills (las de Colonia y las de las otras apps); por defecto, solo las de Colonia. */
  skillRoots?: SkillRoots;
}) {
  const { store, home } = deps;
  const roots: SkillRoots = deps.skillRoots ?? { home };
  const now = () => deps.clock?.() ?? new Date();
  const built = (id: string): Built & { id: string } => {
    const p = store.projects.get(id);
    if (!p) throw notFound(`project ${id}`);
    if (!p.path || !p.present) throw badRequest("this project has no folder on disk to share");
    const b = buildPackage(
      p.path,
      { name: p.name, description: p.description ?? undefined, kind: KINDS.find((k) => k === p.kind) },
      now(),
      allSkills(store, roots, p.id),
    );
    // PROYECTOS-ENLAZADOS-1 · De los proyectos que conoce viaja el nombre, nunca lo que guardan.
    const knows = knownProjects(store, { project_id: p.id }).map((k) => k.name.slice(0, 80));
    b.pkg = withKnown(b.pkg, knows);
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
        removed_in: b.removedIn,
        skipped: b.skipped,
        ...(path_ ? { path: path_ } : {}),
      };
    },
    "projects.share": ({ project, shared }: { project: string; shared: boolean }) => {
      if (!shared) {
        if (!store.projects.get(project)) throw notFound(`project ${project}`);
        dropShared(home, project);
        // ENLACE-TEMPORAL-2 · Cuántos siguen publicados: el enlace temporal sólo se cierra cuando ya no queda ninguno.
        return { shared: false, left: Object.keys(sharedIndex(home)).length };
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
      let kept: string[] = [];
      let plan: ReturnType<typeof skillPlan> | undefined;
      try {
        if (same?.path) {
          plan = skillPlan(pkg, same.path, allSkills(store, roots, same.id));
          kept = writePackage(same.path, pkg, plan.skip);
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
          plan = skillPlan(pkg, root, allSkills(store, roots, id));
          writePackage(root, pkg, plan.skip);
        }
        deps.apc.sync(id);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      // PROYECTOS-ENLAZADOS-1 · Se enlaza con los proyectos de aquí que se llamen igual; el resto queda sin resolver.
      const links = resolveKnown(store, id, knownNames(pkg));
      if (links.found.length) store.projects.setLinks(id, { knows: links.found });
      const project = store.projects.get(id);
      if (!project) throw notFound(`project ${id}`);
      // Lo que ya tenía sus datos no vuelve a salir como «falta conectar».
      const pending = said.pending.filter((c) => !kept.includes(c.name));
      return {
        ...said,
        pending,
        saved: true,
        project: publicProject(project),
        ...(links.missing.length ? { unresolved: links.missing } : {}),
        ...(plan?.conflicts.length ? { skill_conflicts: plan.conflicts } : {}),
      };
    },
  };
}
