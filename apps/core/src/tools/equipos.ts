// Los portátiles del dueño como herramienta: ejecutar un comando, leer un archivo, subir otro. Se ofrecen solo mientras
// haya un equipo conectado al que el dueño haya activado el uso por agentes, y cada llamada además la aprueba el dueño
// del propio equipo (por sesión, o siempre si lo marcó allí). Nada de esto se salta desde aquí.
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export const EQUIPO_CAP = "equipo";

const equipo = z.string().min(1).max(120).describe("Name of the paired computer, as listed by equipo_list");
const MODEL_TEXT_MAX = 100_000;

export function equipoTools(): Tool[] {
  return [
    defineTool({
      name: "equipo_list",
      description:
        "List the owner's computers this agent may use (paired laptops and computers reached over SSH), and whether each is connected now.",
      args: z.object({}),
      effect: "none",
      confirm: "never",
      needsCap: EQUIPO_CAP,
      deadlineMs: 15_000,
      title: () => "Listed your computers",
      async run(_a, ctx) {
        const r = await ctx.call("equipos.list", {});
        const usable = r.equipos.filter((e) => e.agent_access);
        if (!usable.length) return "no computer is enabled for agents";
        return usable
          .map((e) => `${e.name} (${e.platform}) - ${e.connected ? "connected" : "not connected"}`)
          .join("\n");
      },
    }),
    defineTool({
      name: "equipo_run",
      description:
        "Run a shell command on one of the owner's paired computers (PowerShell/cmd on Windows, sh on macOS/Linux). The owner of that computer approves the session there, so the first call may take a while.",
      args: z.object({
        equipo,
        command: z.string().min(1).max(8000),
        cwd: z.string().max(1000).optional().describe("Working folder on that computer"),
        timeout_s: z.number().int().min(1).max(600).optional(),
      }),
      effect: "external",
      confirm: "ask",
      needsCap: EQUIPO_CAP,
      deadlineMs: 700_000,
      explain: (a) => `Ejecutar en «${a.equipo}»: ${a.command}`,
      title: (a) => `Ejecutó un comando en ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.run", {
          equipo: a.equipo,
          command: a.command,
          ...(a.cwd ? { cwd: a.cwd } : {}),
          ...(a.timeout_s ? { timeout_s: a.timeout_s } : {}),
        });
        return `exit code ${r.exit_code ?? "none"}${r.truncated ? " (output cut)" : ""}\n${r.output}`;
      },
    }),
    defineTool({
      name: "equipo_read_file",
      description: "Read a file on one of the owner's paired computers (text is returned; large files are cut).",
      args: z.object({ equipo, path: z.string().min(1).max(1000) }),
      effect: "external",
      confirm: "untrusted",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      title: (a) => `Leyó un archivo de ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.read_file", { equipo: a.equipo, path: a.path });
        const bytes = Buffer.from(r.content_base64, "base64");
        if (bytes.includes(0)) return `binary file, ${r.size} bytes: not shown`;
        const text = bytes.toString("utf8");
        const cut = r.truncated || text.length > MODEL_TEXT_MAX;
        return `${text.slice(0, MODEL_TEXT_MAX)}${cut ? `\n[cut: file is ${r.size} bytes]` : ""}`;
      },
    }),
    // EQUIPOS-SIN-AGENTE-1: también en equipos por terminal remota (SSH), con el mismo interruptor del dueño.
    defineTool({
      name: "equipo_list_files",
      description: "List what is in a folder on one of the owner's computers (names, sizes, dates).",
      args: z.object({ equipo, path: z.string().min(1).max(1000).describe("Folder on that computer") }),
      effect: "external",
      confirm: "untrusted",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      title: (a) => `Miró una carpeta de ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.list_files", { equipo: a.equipo, path: a.path });
        return `${r.output.slice(0, MODEL_TEXT_MAX)}${r.truncated ? "\n[cut]" : ""}`;
      },
    }),
    defineTool({
      name: "equipo_write_file",
      description: "Create or overwrite a text file on one of the owner's paired computers.",
      args: z.object({ equipo, path: z.string().min(1).max(1000), content: z.string().max(4_000_000) }),
      effect: "external",
      confirm: "ask",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      explain: (a) => `Escribir ${a.path} en «${a.equipo}»`,
      title: (a) => `Subió un archivo a ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.write_file", {
          equipo: a.equipo,
          path: a.path,
          content_base64: Buffer.from(a.content, "utf8").toString("base64"),
        });
        return `wrote ${r.written} bytes to ${a.path}`;
      },
    }),
  ];
}
