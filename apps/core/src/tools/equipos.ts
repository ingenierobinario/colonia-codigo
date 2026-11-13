// Los equipos del dueño como herramienta: ejecutar un comando, leer un archivo, subir otro. Se ofrecen mientras haya un
// equipo al que el dueño haya activado el uso por agentes. En un portátil emparejado, cada sesión la aprueba además su
// dueño allí mismo; en uno por terminal remota (SSH) no hay nadie al otro lado, así que la aprueba el dueño aquí, en una
// tarjeta por chat (EQUIPOS-AGENTE-1). Nada de esto se salta desde aquí.
import { z } from "zod";
import { type ApprovalTarget, COLONIA_SERVER, nativeApproval } from "../domain/approvals.ts";
import type { Store } from "../domain/store.ts";
import type { TeamComputer } from "../domain/team-computers.ts";
import { inlineName } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export const EQUIPO_CAP = "equipo";

type Team = Pick<Store, "team" | "settings">;

const equipo = z
  .string()
  .min(1)
  .max(120)
  .describe("Which of the owner's computers: its name or its address (IP), as the owner said it or equipo_list shows");
const MODEL_TEXT_MAX = 100_000;

const isSsh = (c: TeamComputer) => c.transport === "ssh";

/**
 * EQUIPOS-AGENTE-1: las herramientas se ofrecen si el dueño dejó a los agentes algún equipo que pueda contestar. Uno por
 * terminal remota no mantiene conexión (se le llama cuando hace falta), así que cuenta siempre; uno emparejado, mientras
 * esté conectado. Antes solo contaban los emparejados y un equipo por SSH dejaba al agente sin herramientas.
 */
export const equipoCapOn = (computers: readonly TeamComputer[], connected: (id: string) => boolean): boolean =>
  computers.some((c) => c.agent_access && (isSsh(c) || connected(c.id)));

/** Por id, por nombre o por dirección (también «usuario@dirección»): así lo dice el dueño y así lo escribe un agente. */
export function resolveEquipo(computers: readonly TeamComputer[], ref: string): TeamComputer | undefined {
  const wanted = ref
    .trim()
    .replace(/^[«"'“]+|[»"'”]+$/g, "")
    .trim()
    .toLowerCase();
  if (!wanted) return undefined;
  const host = wanted.slice(wanted.lastIndexOf("@") + 1);
  return (
    computers.find((c) => c.id === ref.trim()) ??
    computers.find((c) => c.alias?.toLowerCase() === wanted) ?? // EQUIPOS-ALIAS-1
    computers.find((c) => c.name.toLowerCase() === wanted) ??
    computers.find((c) => c.address !== undefined && c.address.toLowerCase() === host)
  );
}

/** El sitio de la app donde el dueño lo activa, con el nombre exacto de la pantalla y del interruptor en su idioma. */
function place(store: Team): { link: string; toggle: string } {
  return (store.settings.get("owner_language") || "es").startsWith("es")
    ? { link: "[Mis equipos](colonia:equipos)", toggle: "«Dejar que los agentes lo usen»" }
    : { link: "[My computers](colonia:equipos)", toggle: '"Let agents use it"' };
}

const label = (c: TeamComputer) =>
  `${c.alias ? `${inlineName(c.alias)}, ` : ""}${inlineName(c.name)} (${[inlineName(c.platform, 20), c.address ? inlineName(c.address) : "", isSsh(c) ? "remote terminal" : "paired"].filter(Boolean).join(", ")})`;

const accessOff = (store: Team, c: TeamComputer) => {
  const p = place(store);
  return `the owner has not let agents use ${inlineName(c.name)} yet. It is one switch, ${p.toggle}, on that computer's card in ${p.link}. Tell the owner exactly that, with that link written as is; no other setting is involved (not Config › Desktop, not the isolated computer of environments.*).`;
};

/**
 * EQUIPOS-AGENTE-1: lo que el agente tiene a la vista sobre los equipos del dueño, en su prompt. Vacío si no hay ninguno.
 * Solo cambia cuando cambian los equipos o su interruptor (no lleva el estado de conexión), para no romper la caché.
 */
export function equiposBrief(store: Team): string {
  const all = store.team.list();
  if (!all.length) return "";
  const p = place(store);
  const on = all.filter((c) => c.agent_access);
  const off = all.filter((c) => !c.agent_access);
  return [
    on.length
      ? `- The owner's other computers you may use: ${on.map(label).join("; ")}. When the owner names one, by name or address, work THERE with equipo_run, equipo_read_file, equipo_list_files and equipo_write_file (equipo_list tells which are reachable now). screen_snapshot, screen_open, screen_do and the shell act on the machine Colonia runs on, never on those computers, and the isolated computer (environments.*) is a third, unrelated thing. Nothing shows or drives their screen: use commands and files, and say so plainly when a task truly needs the screen. A computer reached by remote terminal waits for the owner's OK on a card here, once per chat.`
      : "",
    off.length
      ? `- ${on.length ? "Other computers of the owner" : "The owner's other computers"} not open to agents: ${off.map(label).join("; ")}. To work on one, the owner turns on ${p.toggle} on its card in ${p.link}; if they ask for it, say exactly that with that link, and name no other setting.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function equipoTools(store: Team): Tool[] {
  /** El equipo que nombra la llamada, ya comprobado: existe y el dueño lo dejó a los agentes. */
  const need = (ref: string): TeamComputer => {
    const all = store.team.list();
    const c = resolveEquipo(all, ref);
    if (!c)
      throw new Error(
        `no computer of the owner is called or at "${inlineName(ref)}". ${
          all.length
            ? `They are: ${all.map(label).join("; ")}`
            : `The owner has added none yet; they add one in ${place(store).link}`
        }`,
      );
    if (!c.agent_access) throw new Error(accessOff(store, c));
    return c;
  };
  /**
   * Un equipo por terminal remota no tiene a nadie delante que apruebe: la tarjeta sale aquí aunque el modo del agente
   * la saltaría, y el dueño la deja para este chat o para siempre. Una sola aprobación por equipo vale para sus cinco
   * herramientas, igual que la sesión que aprueba el dueño de un portátil emparejado.
   */
  const card = (tool: string) => ({
    check: (a: { equipo: string }) => void need(a.equipo),
    keepsCard: (a: { equipo: string }) => {
      const c = resolveEquipo(store.team.list(), a.equipo);
      return c && isSsh(c) ? ("grant" as const) : undefined;
    },
    approvalForCall: async (a: { equipo: string }): Promise<ApprovalTarget> => {
      const c = need(a.equipo);
      return isSsh(c)
        ? { key: `${COLONIA_SERVER}:equipo:${c.id}`, server: COLONIA_SERVER, tool, permanent: false }
        : nativeApproval(tool);
    },
  });
  return [
    defineTool({
      name: "equipo_list",
      description:
        "List the owner's other computers (Mis equipos: paired laptops and computers reached by remote terminal/SSH) with name, system and address, whether each is reachable now, and which ones agents may not use yet and where the owner turns that on. Call it when the owner names a computer you do not recognise. This machine (where Colonia runs) is not in the list.",
      args: z.object({}),
      effect: "none",
      confirm: "never",
      needsCap: EQUIPO_CAP,
      deadlineMs: 15_000,
      title: () => "Listed your computers",
      async run(_a, ctx) {
        const r = await ctx.call("equipos.list", {});
        const byId = new Map(store.team.list().map((c) => [c.id, c]));
        const line = (e: (typeof r.equipos)[number]) => {
          const c = byId.get(e.id);
          return `- ${c ? label(c) : inlineName(e.name)}`;
        };
        const usable = r.equipos.filter((e) => e.agent_access);
        const closed = r.equipos.filter((e) => !e.agent_access);
        const p = place(store);
        return [
          usable.length
            ? "You may use (pass the name or the address as `equipo`):"
            : "no computer is enabled for agents",
          ...usable.map((e) => `${line(e)} - ${e.connected ? "reachable now" : "not reachable now"}`),
          ...(closed.length
            ? [
                `Not open to agents; the owner turns on ${p.toggle} on that computer's card in ${p.link}:`,
                ...closed.map(line),
              ]
            : []),
          ...(r.equipos.length ? [] : [`The owner has added none yet; they add one in ${p.link}.`]),
        ].join("\n");
      },
    }),
    defineTool({
      name: "equipo_run",
      description:
        "Run a shell command on one of the owner's other computers, named by name or address (PowerShell/cmd on Windows, sh on macOS/Linux). This is how you work on a computer the owner names: screen_* tools and the local shell never reach it. The owner approves first (on a card here for a computer reached by remote terminal, on the laptop itself for a paired one), so the first call may take a while.",
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
      ...card("equipo_run"),
      explain: (a) => `Ejecutar en «${a.equipo}»: ${a.command}`,
      title: (a) => `Ejecutó un comando en ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.run", {
          equipo: need(a.equipo).id,
          command: a.command,
          ...(a.cwd ? { cwd: a.cwd } : {}),
          ...(a.timeout_s ? { timeout_s: a.timeout_s } : {}),
        });
        return `exit code ${r.exit_code ?? "none"}${r.truncated ? " (output cut)" : ""}\n${r.output}`;
      },
    }),
    defineTool({
      name: "equipo_read_file",
      description:
        "Read a file on one of the owner's other computers, named by name or address (text is returned; large files are cut).",
      args: z.object({ equipo, path: z.string().min(1).max(1000) }),
      effect: "external",
      confirm: "untrusted",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      ...card("equipo_read_file"),
      explain: (a) => `Leer ${a.path} en «${a.equipo}»`,
      title: (a) => `Leyó un archivo de ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.read_file", { equipo: need(a.equipo).id, path: a.path });
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
      description:
        "List what is in a folder on one of the owner's other computers, named by name or address (names, sizes, dates).",
      args: z.object({ equipo, path: z.string().min(1).max(1000).describe("Folder on that computer") }),
      effect: "external",
      confirm: "untrusted",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      ...card("equipo_list_files"),
      explain: (a) => `Ver la carpeta ${a.path} en «${a.equipo}»`,
      title: (a) => `Miró una carpeta de ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.list_files", { equipo: need(a.equipo).id, path: a.path });
        return `${r.output.slice(0, MODEL_TEXT_MAX)}${r.truncated ? "\n[cut]" : ""}`;
      },
    }),
    defineTool({
      name: "equipo_write_file",
      description: "Create or overwrite a text file on one of the owner's other computers, named by name or address.",
      args: z.object({ equipo, path: z.string().min(1).max(1000), content: z.string().max(4_000_000) }),
      effect: "external",
      confirm: "ask",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      ...card("equipo_write_file"),
      explain: (a) => `Escribir ${a.path} en «${a.equipo}»`,
      title: (a) => `Subió un archivo a ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const r = await ctx.call("equipos.write_file", {
          equipo: need(a.equipo).id,
          path: a.path,
          content_base64: Buffer.from(a.content, "utf8").toString("base64"),
        });
        return `wrote ${r.written} bytes to ${a.path}`;
      },
    }),
  ];
}
