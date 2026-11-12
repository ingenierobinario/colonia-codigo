// Lo que se dicen el principal y el equipo por el canal ya cifrado (channel.ts). Un solo contrato para los dos lados.
import { z } from "zod";

export const EQUIPO_PATH = "/equipo";

/** Lo que un agente puede pedirle a un equipo. */
export const Op = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("run"),
    command: z.string().min(1).max(8000),
    cwd: z.string().max(1000).optional(),
    timeout_s: z.number().int().min(1).max(600).optional(),
  }),
  z.object({ op: z.literal("read"), path: z.string().min(1).max(2000) }),
  z.object({ op: z.literal("write"), path: z.string().min(1).max(2000), content_base64: z.string() }),
]);
export type Op = z.infer<typeof Op>;

/** Quién pide y desde qué sesión: la aprobación del equipo es por sesión de agente. */
export const Who = z.object({ session: z.string().min(1).max(200), name: z.string().max(200) });
export type Who = z.infer<typeof Who>;

export const Result = z.union([
  z.object({ exit_code: z.number().nullable(), output: z.string(), truncated: z.boolean() }),
  z.object({ content_base64: z.string(), size: z.number(), truncated: z.boolean() }),
  z.object({ written: z.number() }),
]);
export type Result = z.infer<typeof Result>;

/** Principal a equipo, ya descifrado. */
export const ToEquipo = z.discriminatedUnion("t", [
  z.object({ t: z.literal("req"), id: z.string(), who: Who, op: Op }),
  z.object({ t: z.literal("revoked") }),
  z.object({ t: z.literal("ready") }),
  z.object({ t: z.literal("paired"), id: z.string() }),
  z.object({ t: z.literal("refused"), why: z.string() }),
]);
export type ToEquipo = z.infer<typeof ToEquipo>;

/** Equipo a principal, ya descifrado. */
export const ToPrincipal = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("res"),
    id: z.string(),
    ok: z.boolean(),
    result: Result.optional(),
    error: z.string().optional(),
  }),
  z.object({ t: z.literal("revoke") }),
  z.object({
    t: z.literal("pair"),
    pub: z.string(),
    name: z.string().min(1).max(80),
    platform: z.string().max(40),
    proof: z.string(),
    sig: z.string(),
  }),
  z.object({ t: z.literal("auth"), sig: z.string() }),
]);
export type ToPrincipal = z.infer<typeof ToPrincipal>;

/** Primer mensaje de cada lado, en claro (no lleva nada secreto: claves efímeras, nonces y firmas). */
export const ClientHello = z.object({
  t: z.literal("hello"),
  mode: z.enum(["pair", "session"]),
  id: z.string().optional(),
  eph: z.string(),
  nonce: z.string(),
});
export const ServerHello = z.object({
  t: z.literal("hello"),
  eph: z.string(),
  nonce: z.string(),
  pub: z.string(),
  sig: z.string(),
});
export const Sealed = z.object({ t: z.literal("x"), d: z.string() });
export const Plain = z.object({ t: z.literal("refused"), why: z.string() });
