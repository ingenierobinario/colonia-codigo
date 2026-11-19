import { setTimeout as sleep } from "node:timers/promises";
import type { MethodName, Params, Result, RunState } from "@colonia/protocol";
import { z } from "zod";
import type { CallContext } from "../rpc/context.ts";
import type { Dispatch } from "../rpc/router.ts";

const key = z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/);
const taskId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+~[a-zA-Z0-9_-]+$/)
  .max(200);
const sendParams = z.object({
  message: z.object({
    role: z.literal("ROLE_USER"),
    messageId: key,
    contextId: key.optional(),
    taskId: taskId.optional(),
    parts: z
      .array(z.object({ text: z.string().max(32000) }).strict())
      .min(1)
      .max(16),
  }),
  configuration: z.object({ returnImmediately: z.boolean().optional() }).optional(),
});
const states: Record<RunState, string> = {
  queued: "SUBMITTED",
  submitted: "SUBMITTED",
  working: "WORKING",
  "input-required": "INPUT_REQUIRED",
  completed: "COMPLETED",
  failed: "FAILED",
  canceled: "CANCELED",
};
class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function a2aService(address: string, agent: string) {
  const endpoint = new URL(address);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/a2a"
  )
    throw new Error("COLONIA_A2A_URL debe ser una URL HTTPS que termine en /a2a.");
  const card = {
    name: agent,
    description: "Agente de Colonia",
    version: "1.0",
    capabilities: {},
    supportedInterfaces: [{ url: endpoint.href, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "consultar",
        name: "Consultar",
        description: "Encarga una tarea de texto a este agente.",
        tags: ["colonia"],
      },
    ],
    securitySchemes: { client: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    securityRequirements: [{ schemes: { client: { list: [] } } }],
  };
  async function handle(
    raw: unknown,
    dispatch: Dispatch,
    ctx: CallContext,
    signal: AbortSignal,
    authorized: () => boolean,
  ) {
    const req = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string().max(200), z.number()]),
        method: z.string(),
        params: z.unknown(),
      })
      .safeParse(raw);
    const rpcId = req.success ? req.data.id : null;
    async function call<M extends MethodName>(method: M, params: Params<M>, idem?: string): Promise<Result<M>> {
      if (!authorized()) throw new RpcError(-32001, "Se ha retirado el acceso al encargo.");
      const r = await dispatch(method, params, ctx, idem);
      if (!r.ok)
        throw new RpcError(
          r.error.code === "unauthorized" || r.error.code === "not_found" ? -32001 : -32603,
          "No se pudo completar el encargo.",
        );
      return r.result as Result<M>;
    }
    const read = async (id: string) => {
      const [thread = "", rid = ""] = id.split("~");
      const info = await call("threads.get", { thread, run: rid });
      const run = info.runs.find((r) => r.id === rid);
      if (!run || run.agent_id !== agent || !info.thread.agent_ids.includes(agent))
        throw new RpcError(-32001, "Encargo desconocido.");
      const message = info.messages.filter((m) => m.run_id === rid && m.author.kind === "agent").at(-1);
      const parts = message?.parts.flatMap((p) => (p.type === "text" ? [{ text: p.text }] : [])) ?? [];
      return {
        id,
        contextId: thread,
        status: { state: "TASK_STATE_" + states[run.state] },
        ...(parts.length && run.state === "completed" ? { artifacts: [{ artifactId: rid, parts }] } : {}),
      };
    };
    try {
      if (!ctx.client?.scopes.includes("chat")) throw new RpcError(-32001, "Acceso denegado.");
      if (!req.success) throw new RpcError(-32600, "Solicitud incorrecta.");
      const { method, params } = req.data;
      let result: unknown;
      if (method === "GetTask" || method === "CancelTask") {
        const { id } = z.object({ id: taskId }).parse(params);
        result = await read(id);
        if (method === "CancelTask") {
          const [thread = "", run = ""] = id.split("~");
          const stopped = await call("threads.cancel", { thread, run }, "a2a:cancel:" + id);
          if (!stopped.canceled) throw new RpcError(-32002, "El encargo ya no se puede cancelar.");
          result = await read(id);
        }
      } else if (method === "SendMessage") {
        const { message, configuration } = sendParams.parse(params);
        const input = message.parts.map((p) => p.text).join("\n");
        if (!input.trim() || input.length > 32000) throw new RpcError(-32602, "Texto fuera de límites.");
        let context = message.contextId;
        if (message.taskId) {
          const prior = await read(message.taskId);
          if (context && context !== prior.contextId) throw new RpcError(-32602, "Contexto incorrecto.");
          throw new RpcError(-32602, "Para continuar, envía un encargo nuevo con el mismo contextId.");
        }
        if (context) {
          const info = await call("threads.get", { thread: context });
          if (!info.thread.agent_ids.includes(agent)) throw new RpcError(-32001, "Contexto desconocido.");
        } else {
          context = (
            await call("threads.create", { kind: "loose", agent_id: agent }, `a2a:new:${agent}:${message.messageId}`)
          ).id;
        }
        const sent = await call(
          "threads.send",
          { thread: context, text: input, mode: "queue" },
          `a2a:send:${context}:${message.messageId}`,
        );
        const id = context + "~" + sent.run.id;
        let task = await read(id);
        while (
          !configuration?.returnImmediately &&
          ["TASK_STATE_WORKING", "TASK_STATE_SUBMITTED"].includes(task.status.state)
        ) {
          await sleep(1000, undefined, { signal });
          task = await read(id);
        }
        result = { task };
      } else throw new RpcError(-32601, "Operación desconocida.");
      return { jsonrpc: "2.0", id: rpcId, result };
    } catch (e) {
      const error =
        e instanceof RpcError
          ? e
          : e instanceof z.ZodError
            ? new RpcError(-32602, "Parámetros incorrectos.")
            : new RpcError(-32603, "No se pudo obtener el resultado.");
      return { jsonrpc: "2.0", id: rpcId, error: { code: error.code, message: error.message } };
    }
  }
  return { card, handle };
}
