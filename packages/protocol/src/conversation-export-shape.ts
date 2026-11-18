import { z } from "zod";

export const CONVERSATION_FILE_BYTES = 64 * 1024 * 1024;
export const CONVERSATION_BYTES = 8 * 1024 * 1024;
export const CONVERSATION_TURNS = 10_000;

export const ExportTurn = z
  .object({
    id: z.string().min(1).max(768),
    role: z.enum(["user", "assistant", "system", "tool", "note"]),
    text: z.string().min(1).max(CONVERSATION_BYTES),
    at: z.iso.datetime().optional(),
  })
  .strict();
export type ExportTurn = z.infer<typeof ExportTurn>;
export const ExportConversation = z
  .object({
    source: z.enum(["chatgpt", "claude", "claude-code", "cowork"]),
    id: z.string().min(1).max(300),
    branch: z.string().min(1).max(768),
    title: z.string().trim().min(1).max(512),
    current: z.literal(true).optional(),
    kind: z.literal("note").optional(),
    turns: z.array(ExportTurn).min(1).max(CONVERSATION_TURNS),
  })
  .strict()
  .refine((c) =>
    c.kind === "note"
      ? c.source === "cowork" &&
        c.branch === "main" &&
        c.turns.length === 1 &&
        c.turns[0]?.role === "note" &&
        c.turns[0].id === "note"
      : c.turns.every((t) => t.role !== "note"),
  )
  .refine((c) => new TextEncoder().encode(JSON.stringify(c)).byteLength <= CONVERSATION_BYTES);
export type ExportConversation = z.infer<typeof ExportConversation>;
