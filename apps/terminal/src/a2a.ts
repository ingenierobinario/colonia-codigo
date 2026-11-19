import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const cardSchema = z.object({
  name: z.string(),
  skills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  supportedInterfaces: z.array(z.object({ protocolBinding: z.string(), protocolVersion: z.string(), url: z.string() })),
});
const id = z.string().min(1).max(256);
const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function remoteAgent(address: string, token?: string, request = fetch) {
  if (token?.startsWith("secret://")) throw new Error("Configura la variable con la credencial del agente.");
  const cardUrl = new URL(address);
  function checked(url: URL) {
    if (
      url.protocol !== "https:" ||
      url.origin !== cardUrl.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new Error("El agente debe usar HTTPS y el mismo origen que su tarjeta.");
    return url;
  }
  checked(cardUrl);
  async function json(url: URL, payload?: object) {
    const response = await request(checked(url), {
      method: payload ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
      headers: {
        Accept: "application/json",
        ...(payload && { "Content-Type": "application/json", "A2A-Version": "1.0" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(payload && { body: JSON.stringify(payload) }),
    });
    if (!response.ok || !response.body) throw new Error(`El agente respondió con HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("La respuesta supera 1 MiB.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  async function discover() {
    const card = cardSchema.parse(await json(cardUrl));
    const iface = card.supportedInterfaces.find(
      (i) => i.protocolBinding === "JSONRPC" && i.protocolVersion === "1.0" && new URL(i.url).origin === cardUrl.origin,
    );
    if (!iface) throw new Error("La tarjeta no ofrece A2A 1.0 con JSON-RPC en este origen.");
    return { name: card.name, skills: card.skills, url: checked(new URL(iface.url)) };
  }
  let discovery: ReturnType<typeof discover> | undefined;
  const get = () =>
    (discovery ??= discover().catch((e) => {
      discovery = undefined;
      throw e;
    }));
  async function call(method: string, params: object) {
    const agent = await get();
    const requestId = randomUUID();
    const reply = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.literal(requestId),
        error: z.object({ code: z.number() }).optional(),
        result: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await json(agent.url, { jsonrpc: "2.0", id: requestId, method, params }));
    if (reply.error || !reply.result)
      throw new Error(`El agente rechazó la operación (${reply.error?.code ?? "respuesta incompleta"}).`);
    return reply.result;
  }
  return {
    skills: async () => {
      const { name, skills } = await get();
      return { name, skills };
    },
    send: (text: string, taskId?: string, contextId?: string) =>
      call("SendMessage", {
        message: { role: "ROLE_USER", messageId: randomUUID(), parts: [{ text }], taskId, contextId },
        configuration: { returnImmediately: true, acceptedOutputModes: ["text/plain"] },
      }),
    task: (taskId: string) => call("GetTask", { id: taskId }),
    cancel: (taskId: string) => call("CancelTask", { id: taskId }),
  };
}

export async function serveAgent(address: string) {
  const agent = remoteAgent(address, process.env.A2A_TOKEN);
  const server = new McpServer({ name: "colonia-a2a", version: "1.0.0" });
  server.registerTool(
    "a2a_skills",
    {
      description: "Consulta las capacidades del agente remoto antes de delegar.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await agent.skills()),
  );
  server.registerTool(
    "a2a_send",
    {
      description:
        "Delega texto al agente. Conserva los identificadores devueltos para consultar o continuar el encargo. Si se interrumpe el envío, comprueba su estado antes de repetirlo.",
      inputSchema: { text: z.string().min(1).max(32000), taskId: id.optional(), contextId: id.optional() },
    },
    async (a) => textResult(await agent.send(a.text, a.taskId, a.contextId)),
  );
  server.registerTool(
    "a2a_status",
    {
      description: "Consulta el estado y los resultados de un encargo anterior.",
      inputSchema: { taskId: id },
      annotations: { readOnlyHint: true },
    },
    async (a) => textResult(await agent.task(a.taskId)),
  );
  server.registerTool(
    "a2a_cancel",
    { description: "Solicita cancelar un encargo del agente remoto.", inputSchema: { taskId: id } },
    async (a) => textResult(await agent.cancel(a.taskId)),
  );
  await server.connect(new StdioServerTransport());
}
