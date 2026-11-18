// COPIA-COMPLETA-1 · La copia completa de Colonia (DECISIONS.md#d-192): un archivo cifrado con la contraseña de la
// persona que lleva todo de un equipo a otro. La copia es grande, así que no viaja por aquí: se escribe y se lee en el
// disco del equipo donde corre Colonia, y estos métodos solo dan la orden y cuentan cómo va.
import { z } from "zod";

/** Cuánto hay de cada cosa, en este equipo o dentro de una copia. */
export const BackupSummary = z.object({
  projects: z.number().int(),
  chats: z.number().int(),
  messages: z.number().int(),
  flows: z.number().int(),
  agents: z.number().int(),
  channels: z.number().int(),
  memories: z.number().int(),
  browsers: z.number().int(),
  apps: z.number().int(),
  providers: z.number().int(),
  people: z.number().int(),
  routines: z.number().int(),
});
export type BackupSummary = z.infer<typeof BackupSummary>;

const ChannelRef = z.object({ id: z.string(), type: z.string(), name: z.string() });

/** Por qué una copia no se pudo escribir o leer. */
export const BackupWhy = z.enum(["foreign", "newer", "password", "broken", "missing", "folder", "busy", "failed"]);
export type BackupWhy = z.infer<typeof BackupWhy>;

/** Lo que quedó tras restaurar una copia, hasta que la persona lo da por visto. */
export const BackupRestored = z.object({
  at: z.string(),
  mode: z.enum(["replace", "merge"]),
  host: z.string(),
  /** Canales cuya sesión no se puede clonar: hay que volver a vincularlos en este equipo. */
  relink: z.array(ChannelRef),
  /** Navegadores y apps que vinieron: su sesión hay que iniciarla de nuevo aquí. */
  browsers: z.number().int(),
  /** La copia de lo que había en este equipo, hecha antes de restaurar. */
  safety: z.string().optional(),
  /** Claves que este equipo no pudo guardar al restaurar: hay que volver a ponerlas en Secretos. */
  secrets_failed: z.array(z.string()).optional(),
  summary: BackupSummary,
});
export type BackupRestored = z.infer<typeof BackupRestored>;

export const BackupStatus = z.object({
  state: z.enum(["idle", "working", "done", "failed"]),
  kind: z.enum(["create", "restore"]).optional(),
  phase: z.enum(["snapshot", "files", "safety", "reading", "restart"]).optional(),
  done: z.number(),
  total: z.number(),
  /** El archivo que se escribió, al acabar una copia. */
  file: z.string().optional(),
  summary: BackupSummary.optional(),
  bytes: z.number().optional(),
  why: BackupWhy.optional(),
  /** Tras preparar una restauración: Colonia se reinicia sola, o hay que cerrarla y abrirla. */
  restart: z.enum(["auto", "manual"]).optional(),
  /** Dónde se guarda una copia si no se dice otra carpeta. */
  folder: z.string(),
  restored: BackupRestored.optional(),
});
export type BackupStatus = z.infer<typeof BackupStatus>;

export const BackupFile = z.object({
  file: z.string(),
  name: z.string(),
  folder: z.string(),
  size: z.number(),
  modified_at: z.string(),
});
export type BackupFile = z.infer<typeof BackupFile>;

/** La contraseña de una copia nueva: la misma longitud mínima que el resto de Colonia (DECISIONS.md#d-190). */
const NewPassword = z.string().min(8).max(1024);
const Password = z.string().min(1).max(1024);
const FilePath = z.string().min(1).max(2000);

export const BackupInspect = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    created_at: z.string(),
    host: z.string(),
    platform: z.string(),
    app_version: z.string(),
    summary: BackupSummary,
    keys: z.number().int(),
    files: z.number().int(),
    bytes: z.number(),
    relink: z.array(ChannelRef),
    /** Lo que hay ahora en este equipo, para decidir entre reemplazar y fusionar. */
    local: BackupSummary,
    has_data: z.boolean(),
  }),
  z.object({ ok: z.literal(false), why: BackupWhy }),
]);
export type BackupInspect = z.infer<typeof BackupInspect>;

export const backupMethods = {
  "backup.status": {
    params: z.object({}).strict(),
    result: BackupStatus,
    effect: false,
    access: "human",
  },
  /** Las copias que hay en las carpetas habituales de este equipo. */
  "backup.list": {
    params: z.object({}).strict(),
    result: z.object({ copies: z.array(BackupFile) }),
    effect: false,
    access: "human",
  },
  /** Empieza a escribir una copia; cómo va se pregunta con `backup.status`. */
  "backup.create": {
    params: z
      .object({ folder: FilePath.optional(), password: NewPassword, include_work: z.boolean().optional() })
      .strict(),
    result: BackupStatus,
    effect: true,
    access: "human",
    replay: false,
  },
  /** Qué trae una copia, sin restaurar nada. */
  "backup.inspect": {
    params: z.object({ file: FilePath, password: Password }).strict(),
    result: BackupInspect,
    effect: false,
    access: "human",
  },
  /** Prepara la restauración y reinicia Colonia para cumplirla. Antes guarda una copia de lo que hay. */
  "backup.restore": {
    params: z.object({ file: FilePath, password: Password, mode: z.enum(["replace", "merge"]) }).strict(),
    result: BackupStatus,
    effect: true,
    access: "human",
    replay: false,
  },
  /** La persona ya vio el resultado de la restauración. */
  "backup.dismiss": {
    params: z.object({}).strict(),
    result: z.object({}),
    effect: true,
    access: "human",
  },
} as const;
