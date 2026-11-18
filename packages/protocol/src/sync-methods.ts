// D-192 fase 2 · Dos equipos del mismo dueño que se ven iguales (DECISIONS.md#d-192). Se emparejan con un código,
// hablan directo y cifrado, y cada uno recibe lo que cambia en el otro. Desactivado hasta que el dueño empareja.
import { z } from "zod";

export const SyncRole = z.enum(["principal", "secundario"]);
export type SyncRole = z.infer<typeof SyncRole>;

const selectedProjects = z.array(z.string().min(1).max(160)).min(1).max(10000);
export const ProjectFilesStatus = z.object({
  state: z.enum(["working", "done", "failed"]),
  projects: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  why: z.enum(["source", "destination", "unsupported", "selection"]).optional(),
});

const continuousProjects = z.array(z.string().min(1).max(160)).min(1).max(256);
export const SyncedFolders = z.object({
  supported: z.boolean().optional(),
  projects: z.array(
    z.object({
      id: z.string(),
      local: z.boolean(),
      remote: z.boolean(),
      state: z.enum(["waiting", "syncing", "current", "offline", "failed"]),
      conflicts: z.number().int().nonnegative(),
    }),
  ),
});

export const SyncStatus = z.object({
  paired: z.boolean(),
  /** Si otro equipo puede llegar a este; si no, el código solo sirve dentro de este mismo equipo. */
  reachable: z.boolean(),
  /** El código que hay que escribir en el otro equipo, mientras vale. */
  pairing: z
    .object({
      code: z.string(),
      expires_at: z.string(),
      initial_source: z.literal("joining_device").optional(),
      allow_managed_folder_sync: z.literal(true).optional(),
    })
    .optional(),
  peer: z.object({ name: z.string() }).optional(),
  /** El principal lleva los canales y las rutinas; el otro los ve y los usa a través de él. */
  role: SyncRole.optional(),
  can_copy_projects: z.boolean().optional(),
  project_files: ProjectFilesStatus.optional(),
  folder_sync: SyncedFolders.optional(),
  connected: z.boolean(),
  /** Los dos equipos tienen versiones de Colonia que no se entienden: hay que actualizar. */
  mismatch: z.boolean(),
  /** Cambios de este equipo que el otro aún no tiene. */
  pending: z.number().int(),
  last_sync_at: z.string().optional(),
  /** Versiones guardadas: lo que perdió frente a un cambio más reciente del otro equipo. */
  saved: z.number().int(),
  /** Proyectos cuya carpeta no está en este equipo: hay que elegir una aquí. */
  folders: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
export type SyncStatus = z.infer<typeof SyncStatus>;

export const SyncSaved = z.object({
  id: z.string(),
  kind: z.enum([
    "project",
    "agent",
    "contact",
    "chat",
    "message",
    "memory",
    "routine",
    "flow",
    "flow_table",
    "task",
    "secret",
    "channel",
    "app",
    "browser",
    "provider",
    "setting",
    "other",
  ]),
  label: z.string(),
  /** La versión guardada era la de este equipo. */
  mine: z.boolean(),
  lost_at: z.string(),
  recovered_at: z.string().optional(),
});
export type SyncSaved = z.infer<typeof SyncSaved>;

const none = z.object({}).strict();

export const syncMethods = {
  "sync.status": { params: none, result: SyncStatus, effect: false, access: "human" },
  /** Un código para escribir en el otro equipo. Este queda como principal. */
  "sync.pair_start": {
    params: z
      .object({
        initial_source: z.literal("joining_device").optional(),
        allow_managed_folder_sync: z.literal(true).optional(),
      })
      .strict(),
    result: SyncStatus,
    effect: true,
    access: "human",
    replay: false,
  },
  "sync.pair_cancel": { params: none, result: SyncStatus, effect: true, access: "human" },
  /** El código que enseña el otro equipo. Este se une a él. */
  "sync.pair_join": {
    params: z
      .object({
        code: z.string().min(1).max(64),
        address: z.string().max(500).optional(),
        projects: selectedProjects.optional(),
        continuous_projects: continuousProjects.optional(),
      })
      .strict(),
    result: SyncStatus,
    effect: true,
    access: "human",
    replay: false,
  },
  /** Deja de sincronizar en los dos equipos. Cada uno se queda con lo que tiene. */
  "sync.unpair": { params: none, result: SyncStatus, effect: true, access: "human" },
  /** Los canales y las rutinas pasan a este equipo. */
  "sync.make_principal": { params: none, result: SyncStatus, effect: true, access: "human" },
  "sync.saved": {
    params: z
      .object({ limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() })
      .strict(),
    result: z.object({ total: z.number().int(), items: z.array(SyncSaved) }),
    effect: false,
    access: "human",
  },
  /** Vuelve a poner una versión guardada; la que había pasa a quedar guardada. */
  "sync.recover": {
    params: z.object({ id: z.string().min(1).max(200) }).strict(),
    result: z.object({ ok: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Borra una versión guardada, o todas si no se dice cuál. Siguen ahí tras desemparejar hasta que se borran. */
  "sync.saved_delete": {
    params: z.object({ id: z.string().min(1).max(200).optional() }).strict(),
    result: z.object({ deleted: z.number().int() }),
    effect: true,
    access: "human",
  },
  /** La carpeta de un proyecto en este equipo, cuando la del otro no existe aquí. */
  "sync.set_folder": {
    params: z.object({ project: z.string().min(1).max(200), path: z.string().min(1).max(1000) }).strict(),
    result: SyncStatus,
    effect: true,
    access: "human",
  },
  /** Autoriza o interrumpe los cambios futuros de esta carpeta en la pareja actual. */
  "sync.set_folder_sync": {
    params: z.object({ project: z.string().min(1).max(160), enabled: z.boolean() }).strict(),
    result: SyncStatus,
    effect: true,
    access: "human",
  },
  "sync.copy_projects": {
    params: z.object({ projects: selectedProjects.optional() }).strict(),
    result: SyncStatus,
    effect: true,
    access: "human",
  },
} as const;
