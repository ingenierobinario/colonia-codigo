// PROYECTO-COMPARTIR-1 · Un proyecto como paquete que otra persona importa en SU Colonia: instrucciones, agentes,
// skills, organización y las conexiones que usa (solo cuáles son, nunca sus valores). Lo que no viaja nunca: claves,
// tokens, cookies, sesiones de canal, contraseñas, chats, tareas, memoria ni rutas del disco de quien exporta.
import { gunzipSync, gzipSync } from "node:zlib";
import { FlowDraftGraph } from "@colonia/protocol/flow-graph";
import { FlowDefinition, ProjectFlowReview } from "@colonia/protocol/flow-methods";
import { z } from "zod";
import { WorkFilePayload } from "./work-file-payload.ts";

export const PROJECT_FORMAT = "colonia-proyecto-1";
/** El paquete entero, como texto: cabe en una llamada al core y en un enlace compartido. */
export const PACKAGE_MAX = 600_000;
/** Un fichero de skill mayor que esto no es texto de instrucciones. */
export const FILE_MAX = 200_000;
const CODE_PREFIX = `${PROJECT_FORMAT}:`;

/** Lo que se pone donde había un dato sensible. */
export const REMOVED = "«quitado»";

const Slug = z.string().regex(/^[a-z][a-z0-9_-]{0,80}$/);
const Folder = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/);
/** Ruta relativa dentro de una skill: sin subir de carpeta ni empezar por barra. */
const RelPath = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._ -]*(\/[A-Za-z0-9_][A-Za-z0-9._ -]*)*$/);
const VarName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,100}$/);

const Connection = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
    command: z.string().max(400).optional(),
    args: z.array(z.string().max(1000)).max(60).default([]),
    url: z.string().url().max(1000).optional(),
    /** NOMBRES de lo que hay que rellenar al importar; el valor no viaja. */
    needs: z.array(VarName).max(40).default([]),
    headers: z
      .array(z.string().regex(/^[A-Za-z0-9-]{1,100}$/))
      .max(40)
      .default([]),
  })
  .strict();

/** PROYECTOS-ENLAZADOS-1 · Los proyectos que este conoce, solo por NOMBRE: nada de lo que guardan viaja. */
const Known = z.array(z.string().trim().min(1).max(80)).max(16);

/**
 * RUTINAS-VIAJAN-1 · Una rutina viaja como texto y horario, y se importa APAGADA: quien importa decide si la enciende.
 * Nunca viajan sus órdenes de consola (pre/post) ni las rutinas que solo son consola: serían código del otro corriendo
 * en esta máquina. Va dentro de `organization` (no estricto) para que una Colonia anterior ignore el campo.
 */
export const PackageRoutine = z.object({
  name: z.string().trim().min(1).max(120),
  agent: Slug,
  schedule: z.unknown(),
  action: z.enum(["agent", "message"]),
  prompt: z.string().max(FILE_MAX),
  call_model: z.enum(["always", "output", "succeeds", "fails", "never"]).optional(),
  max_steps: z.number().int().min(1).max(10_000).optional(),
});
export type PackageRoutine = z.infer<typeof PackageRoutine>;

const PackageDrawing = FlowDraftGraph.refine((g) => Buffer.byteLength(JSON.stringify(g)) <= 131072);
export const PackageFlow = FlowDefinition.pick({
  name: true,
  predicates: true,
  tableKey: true,
  readKeys: true,
  action: true,
})
  .extend({
    key: z.string().regex(/^[a-f0-9]{32}$/),
    drawing: PackageDrawing.optional(),
    previousDrawing: PackageDrawing.optional(),
  })
  .strict();
export type PackageFlow = z.infer<typeof PackageFlow>;

export const ProjectPackage = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    exported_at: z.string().max(40),
    project: z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500).optional(),
        kind: z.enum(["personal", "app", "company", "software", "other"]).optional(),
      })
      .strict(),
    instructions: z.string().max(FILE_MAX),
    /**
     * PROYECTOS-ENLAZADOS-2 · `knows` viaja AQUÍ dentro: es el único objeto del paquete que no es estricto, así que
     * una Colonia anterior (hasta la 2.36.26) lo descarta al leer y sigue importando el paquete. En cualquier otro
     * sitio, su lector lo rechaza entero por «clave no reconocida». Quien importa enlaza por nombre lo que tenga.
     */
    organization: z
      .object({
        files: WorkFilePayload.optional(),
        areas: z.array(z.unknown()).max(40),
        roles: z.array(z.unknown()).max(200),
        knows: Known.optional(),
        routines: z.array(PackageRoutine).max(50).optional(),
        flows: z.array(PackageFlow).max(1000).optional(),
        flowReview: z.array(ProjectFlowReview).max(8).optional(),
      })
      .optional(),
    agents: z.array(z.object({ slug: Slug, text: z.string().max(FILE_MAX) }).strict()).max(200),
    skills: z
      .array(
        z
          .object({
            folder: Folder,
            files: z.array(z.object({ path: RelPath, text: z.string().max(FILE_MAX) }).strict()).max(60),
          })
          .strict(),
      )
      .max(100),
    connections: z.array(Connection).max(60),
    /** Solo se LEE: así lo escribió la 2.36.27. Ya no se escribe, porque una Colonia anterior rechaza el paquete. */
    knows: Known.optional(),
  })
  .strict();
export type ProjectPackage = z.infer<typeof ProjectPackage>;

/** Los nombres de los proyectos que conoce el proyecto de un paquete, lo escribiera esta versión o la 2.36.27. */
export function knownNames(pkg: ProjectPackage): string[] {
  return [...new Set([...(pkg.organization?.knows ?? []), ...(pkg.knows ?? [])])].slice(0, 16);
}

/** El paquete con esos nombres donde una Colonia anterior los ignora; sin nombres, el paquete de siempre. */
export function withKnown(pkg: ProjectPackage, names: string[]): ProjectPackage {
  if (!names.length) return pkg;
  const { areas = [], roles = [] } = pkg.organization ?? {};
  return { ...pkg, organization: { ...pkg.organization, areas, roles, knows: names.slice(0, 16) } };
}
/** RUTINAS-VIAJAN-1 · El paquete con sus rutinas dentro de `organization`. */
export function withRoutines(pkg: ProjectPackage, routines: PackageRoutine[]): ProjectPackage {
  if (!routines.length) return pkg;
  const { areas = [], roles = [] } = pkg.organization ?? {};
  return { ...pkg, organization: { ...pkg.organization, areas, roles, routines: routines.slice(0, 50) } };
}
export type PackageConnection = z.infer<typeof Connection>;

/** Qué lleva un paquete, en cifras: lo que se enseña antes de exportar o de importar. */
export type PackageSummary = {
  files?: string[];
  name: string;
  description: string;
  agents: number;
  skills: number;
  connections: number;
  organization: boolean;
  flows?: number;
  flow_review?: ProjectFlowReview[];
};

export const summaryOf = (p: ProjectPackage): PackageSummary => ({
  name: p.project.name,
  description: p.project.description ?? "",
  ...(p.organization?.files?.length ? { files: p.organization.files.map((file) => file.path) } : {}),
  agents: p.agents.length,
  skills: p.skills.length,
  connections: p.connections.length,
  ...(p.organization?.flows?.length ? { flows: p.organization.flows.length } : {}),
  ...(p.organization?.flowReview?.length ? { flow_review: p.organization.flowReview } : {}),
  organization: Boolean(p.organization && p.organization.areas.length + p.organization.roles.length),
});

// ── Quitar datos sensibles de un texto ────────────────────────────────────────────────────────────────────────────

const SENSITIVE_KEY =
  "pass(?:word|wd|phrase)?|contrase(?:ñ|n)a|clave(?:[ _-]?(?:api|secreta|privada))?|secreto?|secret(?:[ _-]?key)?|" +
  "token|api[ _-]?key|apikey|access[ _-]?key|auth(?:orization)?|cookie|session(?:[ _-]?id)?|credential[s]?|pwd";

/** TEXTO-LIBRE-1 · Las palabras tras las que un dato suelto («el token abc123…», «la clave es abc123…») es el dato. */
const LOOSE_KEY =
  "pass(?:word|wd|phrase)?|contrase(?:ñ|n)a|clave(?:[ _-]?(?:api|secreta|privada))?|secret(?:[ _-]?key)?|" +
  "token|api[ _-]?key|apikey|access[ _-]?key|pwd";

/** Bits por carácter: lo que distingue «a8Kq2ZxP0vLm…» de «claude-3-5-sonnet-20241022». */
function entropy(s: string): number {
  const seen = new Map<string, number>();
  for (const ch of s) seen.set(ch, (seen.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of seen.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}
const MIXED = /^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9_~+=.:-]{20,}$/;

/**
 * TEXTO-LIBRE-1 · Un trozo suelto (un argumento de una conexión, un tramo de una dirección) con pinta de clave: lo
 * que ya reconoce `scrub`, o 20 caracteres o más mezclando letras y cifras. En un argumento se pide además que no
 * parezcan palabras (`loose` = false), porque ahí también van nombres de modelo y de paquete.
 */
export function secretLike(piece: string, loose: boolean): boolean {
  if (piece.includes(REMOVED)) return false;
  if (scrub(piece).removed > 0) return true;
  return MIXED.test(piece) && (loose || entropy(piece) >= 4);
}

/** Reglas en orden: cada una cambia el dato por REMOVED y deja el resto de la frase. */
const RULES: Array<[RegExp, (m: string, ...g: string[]) => string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, () => REMOVED],
  // Cabeceras que llevan una sesión entera: hasta el final de la línea.
  [/\b((?:set-)?cookie|authorization)(\s*[:=]\s*)(?!secret:\/\/)[^\r\n]+/gi, (_m, k, sep) => `${k}${sep}${REMOVED}`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, (_m, k) => `${k} ${REMOVED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, () => REMOVED],
  // Claves con prefijo conocido de los servicios habituales.
  [
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bxox[abeprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bya29\.[A-Za-z0-9._-]{20,}|\bEAA[A-Za-z0-9]{30,}|\bnpm_[A-Za-z0-9]{30,}|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    () => REMOVED,
  ],
  // TEXTO-LIBRE-1 · Tokens de bot: Discord (tres tramos) y Telegram (número:35 caracteres).
  [/(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g, () => REMOVED],
  [/(?<![A-Za-z0-9_-])[0-9]{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, () => REMOVED],
  // Usuario y contraseña dentro de una dirección.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (_m, scheme) => `${scheme}${REMOVED}@`],
  // Parámetros de una dirección que llevan un dato de acceso.
  [
    /([?&](?:[a-z_-]*(?:token|key|secret|password|passwd|signature|sig|auth|session|sid|code)[a-z_-]*)=)[^&\s#"'<>)]+/gi,
    (_m, k) => `${k}${REMOVED}`,
  ],
  // «contraseña: valor», «API_KEY=valor», "token": "valor". Una referencia (secret://, ${VAR}, <tu clave>) se queda.
  // SECRETO-ANIDADO-1 · El valor puede ir en la línea siguiente, pero no si esa línea es otra «clave: valor»: en
  // «auth:\n  client_secret: X» se tachaba «client_secret:» y X salía entero.
  [
    new RegExp(
      `((?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:${SENSITIVE_KEY})(?:[_-][A-Za-z0-9]+)*["'\`]?\\s*(?:[:=]|=>)(?:[ \\t]*|\\s*(?![^\\s:=]+[ \\t]*(?:[:=]|=>)(?:\\s|$))))("[^"\\r\\n]{3,}"|'[^'\\r\\n]{3,}'|\`[^\`\\r\\n]{3,}\`|[^\\s"'\`,;<>{}()\\[\\]$]{4,})`,
      "gi",
    ),
    (m, k, v) => (/^["'`]?(?:secret:\/\/|\/\/|\$\{|<|\{\{|«)/.test(v) || v.includes(REMOVED) ? m : `${k}${REMOVED}`),
  ],
  // TEXTO-LIBRE-1 · Sin dos puntos ni igual: «el token abc123def», «la clave es abc123def». Solo si el dato mezcla
  // letras y cifras, para no tachar «la clave es importante» ni «el token de acceso».
  [
    new RegExp(
      `((?:^|[^A-Za-z0-9_-])(?:${LOOSE_KEY})[ \\t]+(?:(?:es|is|ser[aá]|era|was)[ \\t]+)?["'\`]?)((?=[^\\s"'\`]*[0-9])(?=[^\\s"'\`]*[A-Za-z])[A-Za-z0-9_~+/=.:!@#%^&*-]{8,})`,
      "gi",
    ),
    (m, k, v) => {
      // El punto o los dos puntos que cierran la frase no son parte del dato.
      const end = /[.:]+$/.exec(v)?.[0] ?? "";
      const data = end ? v.slice(0, -end.length) : v;
      return data.length < 8 || /^(?:secret:|https?:|\/\/)/i.test(data) ? m : `${k}${REMOVED}${end}`;
    },
  ],
  // TEXTO-LIBRE-1 · Base64 corriente (con «+» y «/»): 40 o más, con mayúsculas, minúsculas y cifras, y casi sin barras
  // para no confundirlo con una ruta.
  [
    /(?<![A-Za-z0-9+/=_.-])(?=[A-Za-z0-9+/]*[0-9])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=_.-])/g,
    (m) => ((m.match(/\//g)?.length ?? 0) * 16 > m.length ? m : REMOVED),
  ],
  // Lo que queda con pinta de clave: 32 o más caracteres seguidos mezclando letras y cifras (un hash, un token).
  [
    /(?<![A-Za-z0-9_/.-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_/.-])/g,
    () => REMOVED,
  ],
];

/** El texto sin datos de acceso, y cuántos se quitaron. */
export function scrub(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const [re, put] of RULES)
    out = out.replace(re, (...a) => {
      const next = put(...(a as [string, ...string[]]));
      if (next !== a[0]) removed++;
      return next;
    });
  return { text: out, removed };
}

/** Nombres de fichero que guardan credenciales o sesiones: no se exportan aunque estén dentro de una skill. */
export { sensitiveFile } from "./project-file-name.ts";

/** Una conexión tal como viaja: qué servidor es y qué hay que rellenar, sin un solo valor. */
export function connectionOf(
  name: string,
  raw: unknown,
): { connection: PackageConnection; removed: number } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const names = (v: unknown, ok: RegExp) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).filter((k) => ok.test(k)) : [];
  let removed = 0;
  const clean = (s: string) => {
    const c = scrub(s);
    removed += c.removed;
    return c.text;
  };
  const rawArgs = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === "string") : [];
  const args = rawArgs.slice(0, 60).map((a, i) => {
    // Lo que sigue a «--token», «--api-key»… es el dato, venga como venga.
    const flag = rawArgs[i - 1] ?? "";
    if (
      /^--?[a-z0-9-]*(token|key|secret|pass|password|auth|cookie|credential)[a-z0-9-]*$/i.test(flag) &&
      !a.startsWith("-")
    ) {
      removed++;
      return REMOVED;
    }
    // TEXTO-LIBRE-1 · Un argumento suelto que es una clave («npx srv a8Kq2ZxP…»).
    if (!a.startsWith("-") && secretLike(a, false)) {
      removed++;
      return REMOVED;
    }
    return clean(a).slice(0, 1000);
  });
  let url: string | undefined;
  if (typeof r.url === "string") {
    try {
      const u = new URL(r.url);
      if (u.username || u.password || u.search) removed++;
      // TEXTO-LIBRE-1 · Un tramo de la dirección que es una clave («…/a8Kq2ZxP…/sse»).
      const pathname = u.pathname
        .split("/")
        .map((seg) => {
          let plain = seg;
          try {
            plain = decodeURIComponent(seg);
          } catch {}
          if (!secretLike(plain, true)) return seg;
          removed++;
          return REMOVED;
        })
        .join("/");
      url = clean(`${u.protocol}//${u.host}${pathname}`);
    } catch {
      url = undefined;
    }
  }
  const command = typeof r.command === "string" && r.command.trim() ? clean(r.command.trim()).slice(0, 400) : undefined;
  if (!command && !url) return undefined;
  const parsed = Connection.safeParse({
    name,
    ...(command ? { command } : {}),
    args: command ? args : [],
    ...(url && !command ? { url } : {}),
    needs: names(r.env, /^[A-Za-z_][A-Za-z0-9_.-]{0,100}$/).slice(0, 40),
    headers: names(r.headers, /^[A-Za-z0-9-]{1,100}$/).slice(0, 40),
  });
  return parsed.success ? { connection: parsed.data, removed } : undefined;
}

// ── Leer un paquete ───────────────────────────────────────────────────────────────────────────────────────────────

export type Parsed =
  | { ok: true; pkg: ProjectPackage }
  /** `foreign`: no es un proyecto de Colonia · `newer`: lo hizo una versión posterior · `broken`: lo es, pero está dañado. */
  | { ok: false; why: "foreign" | "newer" | "broken"; detail?: string };

/** Lee un paquete desde el fichero exportado o desde un código para compartir. Nunca lanza. */
export function parsePackage(input: string): Parsed {
  let text = input.trim().replace(/^﻿/, "");
  const code = /^colonia-proyecto-(\d+):([A-Za-z0-9_-]+)$/.exec(text.replace(/\s+/g, ""));
  if (code) {
    if (Number(code[1]) > 1) return { ok: false, why: "newer" };
    try {
      text = gunzipSync(Buffer.from(code[2] as string, "base64url"), { maxOutputLength: PACKAGE_MAX * 4 }).toString(
        "utf8",
      );
    } catch {
      return { ok: false, why: "broken", detail: "the code is incomplete" };
    }
  }
  if (text.length > PACKAGE_MAX * 4) return { ok: false, why: "broken", detail: "too large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: "foreign" };
  }
  const format =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { format?: unknown }).format : undefined;
  const version = typeof format === "string" ? /^colonia-proyecto-(\d+)$/.exec(format)?.[1] : undefined;
  if (!version) return { ok: false, why: "foreign" };
  if (Number(version) > 1) return { ok: false, why: "newer" };
  const parsed = ProjectPackage.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, why: "broken", detail: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""}` };
  }
  return { ok: true, pkg: parsed.data };
}

/** El paquete como fichero: JSON legible, para que quien lo reciba pueda abrirlo y ver qué lleva. */
export const renderPackage = (pkg: ProjectPackage) => `${JSON.stringify(pkg, null, 2)}\n`;

/** El paquete como una sola línea que se puede pegar en un mensaje. */
export const packageCode = (pkg: ProjectPackage) =>
  `${CODE_PREFIX}${gzipSync(Buffer.from(JSON.stringify(pkg), "utf8")).toString("base64url")}`;
