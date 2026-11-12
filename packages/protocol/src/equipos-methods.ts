// Mis equipos: los portátiles del dueño, emparejados con este Colonia con un código de un solo uso que se confirma EN el
// propio equipo. Un agente solo usa un equipo si el dueño lo activó para él y, además, el equipo lo aprueba (cada sesión,
// o siempre si su dueño lo marcó allí). Nada de esto se puede saltar desde el lado de Colonia principal.
import { z } from "zod";
import { Id } from "./domain.ts";

export const EquipoPlatform = z.enum(["windows", "macos", "linux", "other"]);
export type EquipoPlatform = z.infer<typeof EquipoPlatform>;

export const Equipo = z.object({
  id: Id,
  name: z.string(),
  platform: EquipoPlatform,
  created_at: z.string(),
  last_seen_at: z.string().optional(),
  /** Conectado ahora mismo (el equipo llama hacia fuera y mantiene la conexión abierta). */
  connected: z.boolean(),
  /** El dueño permitió que los agentes de Colonia usen este equipo como herramienta. */
  agent_access: z.boolean(),
  /** Un agente lo está usando ahora. */
  in_use: z.boolean(),
});
export type Equipo = z.infer<typeof Equipo>;

export const EquipoAuditEntry = z.object({
  n: z.number(),
  at: z.string(),
  equipo_id: Id.optional(),
  /** pair · connect · disconnect · run · read · write · denied · revoke · access */
  kind: z.string(),
  detail: z.string(),
});
export type EquipoAuditEntry = z.infer<typeof EquipoAuditEntry>;

/** Lo que el equipo muestra a su dueño: una petición de un agente que espera su visto bueno. */
export const EquipoPending = z.object({
  id: z.string(),
  at: z.string(),
  /** Quién pide (el agente) y qué quiere hacer, en palabras llanas. */
  who: z.string(),
  summary: z.string(),
});
export type EquipoPending = z.infer<typeof EquipoPending>;

export const EquipoLocalState = z.object({
  /** Este equipo está emparejado con un Colonia principal. */
  paired: z.boolean(),
  principal: z.object({ url: z.string(), fingerprint: z.string() }).optional(),
  name: z.string().optional(),
  connected: z.boolean(),
  /** «Permitir siempre a este Colonia»: solo se cambia desde este equipo. */
  always_allow: z.boolean(),
  /** La clave está cifrada con contraseña y aún no se ha desbloqueado: no se conecta hasta entonces. */
  locked: z.boolean(),
  /** Este equipo no tiene almacén de claves del sistema: para emparejar hace falta una contraseña. */
  needs_passphrase: z.boolean(),
  in_use: z.boolean(),
  pending: z.array(EquipoPending),
  audit: z.array(EquipoAuditEntry),
});
export type EquipoLocalState = z.infer<typeof EquipoLocalState>;

const Path = z.string().min(1).max(1000);

export const equiposMethods = {
  "equipos.list": {
    params: z.object({}).strict(),
    result: z.object({ equipos: z.array(Equipo) }),
    effect: false,
    access: "human",
  },
  /**
   * Código de un solo uso (6 dígitos, 10 minutos, 5 intentos) y los dos comandos de instalación. El comando lleva la
   * huella de este Colonia: el equipo comprueba que habla con él y no con otro.
   */
  "equipos.pair_start": {
    params: z.object({}).strict(),
    result: z.object({
      code: z.string(),
      expires_at: z.string(),
      fingerprint: z.string(),
      urls: z.array(z.string()),
      commands: z.object({ windows: z.string(), unix: z.string() }),
    }),
    effect: true,
    access: "human",
    replay: false,
  },
  "equipos.pair_cancel": {
    params: z.object({}).strict(),
    result: z.object({ canceled: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Activa o apaga que los agentes usen este equipo como herramienta. */
  "equipos.set_access": {
    params: z.object({ id: Id, enabled: z.boolean() }).strict(),
    result: Equipo,
    effect: true,
    access: "human",
  },
  /** Desconecta y revoca la clave del equipo: para volver a usarlo hay que emparejarlo de nuevo. */
  "equipos.revoke": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ revoked: z.boolean() }),
    effect: true,
    access: "human",
  },
  "equipos.audit": {
    params: z.object({ id: Id.optional() }).strict(),
    result: z.object({ entries: z.array(EquipoAuditEntry) }),
    effect: false,
    access: "human",
  },
  /** Herramientas de los agentes: solo con el equipo activado por el dueño Y aprobado en el propio equipo. */
  "equipos.run": {
    params: z
      .object({
        equipo: z.string().min(1).max(120),
        command: z.string().min(1).max(8000),
        cwd: Path.optional(),
        timeout_s: z.number().int().min(1).max(600).optional(),
      })
      .strict(),
    result: z.object({ exit_code: z.number().nullable(), output: z.string(), truncated: z.boolean() }),
    effect: true,
  },
  "equipos.read_file": {
    params: z.object({ equipo: z.string().min(1).max(120), path: Path }).strict(),
    result: z.object({ content_base64: z.string(), size: z.number(), truncated: z.boolean() }),
    effect: false,
  },
  "equipos.write_file": {
    params: z
      .object({ equipo: z.string().min(1).max(120), path: Path, content_base64: z.string().max(12_000_000) })
      .strict(),
    result: z.object({ written: z.number() }),
    effect: true,
  },
  /** Lado del portátil: estado, emparejar y decidir. Solo desde el propio equipo. */
  "equipos.local_state": {
    params: z.object({}).strict(),
    result: EquipoLocalState,
    effect: false,
    access: "human",
    local: true,
  },
  /** El código se teclea AQUÍ, en el equipo; la huella viene del comando que copió el dueño. */
  "equipos.local_pair": {
    params: z
      .object({
        // EQUIPO-ARGS-1: la dirección y la huella acaban como argumentos de un programa; solo los caracteres de una
        // dirección y de una huella, nunca los de una orden de consola (& | ; " ` $ espacio).
        url: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .regex(/^(https?|wss?):\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/),
        fingerprint: z
          .string()
          .trim()
          .min(8)
          .max(100)
          .regex(/^[0-9a-fA-F][0-9a-fA-F-]*$/),
        code: z.string().trim().min(6).max(8),
        /** Solo si este equipo no tiene almacén de claves del sistema: protege la clave en disco. */
        passphrase: z.string().min(8).max(200).optional(),
        name: z.string().trim().min(1).max(60).optional(),
      })
      .strict(),
    result: z.object({ name: z.string() }),
    effect: true,
    access: "human",
    local: true,
    replay: false,
  },
  /** Sin almacén de claves del sistema, la contraseña desbloquea la clave tras reiniciar. */
  "equipos.local_unlock": {
    params: z.object({ passphrase: z.string().min(1).max(200) }).strict(),
    result: z.object({ unlocked: z.boolean() }),
    effect: true,
    access: "human",
    local: true,
    replay: false,
  },
  "equipos.local_decide": {
    params: z.object({ id: z.string().min(1).max(100), allow: z.boolean() }).strict(),
    result: z.object({ decided: z.boolean() }),
    effect: true,
    access: "human",
    local: true,
  },
  "equipos.local_always": {
    params: z.object({ enabled: z.boolean() }).strict(),
    result: z.object({ always_allow: z.boolean() }),
    effect: true,
    access: "human",
    local: true,
  },
  /** Desde el portátil: corta la conexión y borra la clave. */
  "equipos.local_disconnect": {
    params: z.object({}).strict(),
    result: z.object({ disconnected: z.boolean() }),
    effect: true,
    access: "human",
    local: true,
  },
} as const;
