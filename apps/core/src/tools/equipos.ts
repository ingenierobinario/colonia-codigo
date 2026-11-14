// Los equipos del dueño como herramienta: ejecutar un comando, leer un archivo, subir otro. Se ofrecen mientras haya un
// equipo al que el dueño haya activado el uso por agentes. En un portátil emparejado, cada sesión la aprueba además su
// dueño allí mismo; en uno por terminal remota (SSH) no hay nadie al otro lado, así que la aprueba el dueño aquí, en una
// tarjeta por chat (EQUIPOS-AGENTE-1). Nada de esto se salta desde aquí.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { type ApprovalTarget, COLONIA_SERVER, nativeApproval } from "../domain/approvals.ts";
import type { Store } from "../domain/store.ts";
import type { TeamComputer } from "../domain/team-computers.ts";
import {
  GUI_ARGS_MAX,
  GUI_TARGET_MAX,
  GUI_TIMEOUT_S,
  type GuiResult,
  guiOpenCommand,
  guiOs,
  parseGuiResult,
} from "../equipos/gui.ts";
import {
  imageInfo,
  parseScreenResult,
  SCREEN_STEPS_MAX,
  SCREEN_TEXT_MAX,
  SCREEN_TIMEOUT_S,
  type ScreenPlan,
  type ScreenResult,
  type ScreenStep,
  screenCleanupCommand,
  screenDoPlan,
  screenShotPlan,
} from "../equipos/pantalla.ts";
import { stepsText } from "./computer.ts";
import { inlineName, untrusted } from "./result.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

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
      ? `- The owner's other computers you may use: ${on.map(label).join("; ")}. When the owner names one, by name or address, work THERE with equipo_run, equipo_open, equipo_screenshot, equipo_do, equipo_read_file, equipo_list_files and equipo_write_file (equipo_list tells which are reachable now). screen_snapshot, screen_open, screen_do and the shell act on the machine Colonia runs on, never on those computers, and the isolated computer (environments.*) is a third, unrelated thing. To put an app, a file or a web page on the screen of one of them, use equipo_open: a window started with equipo_run is born where nobody sees it. To see that screen use equipo_screenshot, and to click or type on it equipo_do. When one of them says what is missing there, tell them just that, and never send the owner to look for another kind of connection in Mis equipos, because there is none. A computer reached by remote terminal waits for the owner's OK on a card here, once per chat.`
      : "",
    off.length
      ? `- ${on.length ? "Other computers of the owner" : "The owner's other computers"} not open to agents: ${off.map(label).join("; ")}. To work on one, the owner turns on ${p.toggle} on its card in ${p.link}; if they ask for it, say exactly that with that link, and name no other setting.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type RawStep = {
  do: "click" | "key" | "type";
  x?: number | undefined;
  y?: number | undefined;
  keys?: string | undefined;
  text?: string | undefined;
};
/** Los pasos tal como llegan (campos opcionales) a los que entiende el equipo; lanza diciendo qué le falta a cuál. */
function steps(raw: readonly RawStep[]): ScreenStep[] {
  return raw.map((st, i) => {
    if (st.do === "click" && st.x !== undefined && st.y !== undefined) return { do: "click", x: st.x, y: st.y };
    if (st.do === "key" && st.keys) return { do: "key", keys: st.keys };
    if (st.do === "type" && st.text) return { do: "type", text: st.text };
    throw new Error(
      `step ${i + 1} (${st.do}) is missing ${st.do === "click" ? "x and y" : st.do === "key" ? "keys" : "text"}`,
    );
  });
}

/**
 * EQUIPO-GUI-1: lo que pasó al abrir, dicho al agente con lo que tiene que contarle al dueño. Cuando no se pudo, dice
 * qué falta exactamente y quién lo arregla; nunca manda a buscar «otra conexión».
 */
export function guiSay(r: GuiResult, name: string, target: string, link = "[Mis equipos](colonia:equipos)"): string {
  switch (r.state) {
    case "opened": {
      const lock = r.locked
        ? ` The screen of ${name} is locked: it is open, and the owner sees it when they unlock.`
        : "";
      const now = r.started.length
        ? ` Started there just now: ${r.started.map((s) => inlineName(s, 40)).join(", ")}.`
        : "";
      if (r.alive === true)
        return `opened ${target} on the desktop of ${name}, signed in as ${inlineName(r.user)}; checked two seconds later: it is running.${now}${lock}`;
      if (r.alive === false)
        return `${target} was started on the desktop of ${name} (signed in as ${inlineName(r.user)}) but two seconds later it was not running any more and nothing new had appeared: it closed by itself or handed over to a window that was already open. Say that plainly; do not claim it is open.${lock}`;
      return `asked the desktop of ${name} (signed in as ${inlineName(r.user)}) to open ${target} and it accepted; this system does not tell whether the window is still there, so say it was opened and ask the owner to confirm if it matters.${lock}`;
    }
    case "no_session":
      return `not opened: nobody is signed in on ${name}, so there is no desktop to show a window on. Tell the owner exactly that: someone has to sign in on that computer (its own screen, not the remote terminal) and then you try again. No setting of Colonia fixes it and no other connection is needed.`;
    case "other_user":
      return `not opened: the desktop of ${name} belongs to another user${r.who ? ` (${inlineName(r.who)})` : ""}, not to the account Colonia connects with, and that account may not open windows for them. Tell the owner exactly that: either they sign in there with the connected account, or they connect that computer in ${link} with the user who is signed in.`;
    case "not_started":
      return `not opened: ${name} accepted the request but the desktop did not start it within 15 seconds (it may be busy, or its task scheduler is off). Nothing was left behind there. Try once more; if it repeats, tell the owner that.`;
    case "error":
      return `not opened on ${name}: ${r.detail}`;
  }
}

/**
 * EQUIPO-GUI-1: por qué no se pudo ver o manejar la pantalla, dicho al agente con lo que falta y cómo se arregla.
 * `did` es lo que se intentaba ("no picture taken", "nothing was done").
 */
export function screenSay(
  r: Exclude<ScreenResult, { state: "shot" | "done" }>,
  name: string,
  did: string,
  link = "[Mis equipos](colonia:equipos)",
): string {
  switch (r.state) {
    case "step_error":
      return `step ${r.step} failed on ${name}: ${r.detail || "no reason given"}. The steps before it were done, the later ones were not.`;
    case "locked":
      return `${did}: the screen of ${name} is locked. Tell the owner exactly that: someone has to unlock it there (its own keyboard), and then you try again. It cannot be unlocked from here.`;
    case "no_session":
      return `${did}: nobody is signed in on ${name}, so it has no desktop to see or use. Tell the owner exactly that: someone has to sign in on that computer (its own screen, not the remote terminal) and then you try again. No setting of Colonia fixes it and no other connection is needed.`;
    case "other_user":
      return `${did}: the desktop of ${name} belongs to another user${r.who ? ` (${inlineName(r.who)})` : ""}, not to the account Colonia connects with, and that account may not see or use their screen. Tell the owner exactly that: either they sign in there with the connected account, or they connect that computer in ${link} with the user who is signed in.`;
    case "not_started":
      return `${did}: ${name} accepted the request but its desktop did not answer within 40 seconds (it may be busy, or its task scheduler is off). Nothing was left behind there. Try once more; if it repeats, tell the owner that.`;
    case "permission":
      return r.what === "screen"
        ? `${did}: macOS on ${name} does not let the remote terminal record the screen${r.detail ? ` (${r.detail})` : ""}. The owner allows it once, on that Mac: System Settings › Privacy & Security › Screen Recording, turn on the entry of the remote login (sshd-keygen-wrapper, or add /usr/libexec/sshd-keygen-wrapper with +). You can put that pane in front of them with equipo_open and target "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture". Tell the owner exactly that; then try again.`
        : `${did}: macOS on ${name} does not let the remote terminal use the pointer and the keyboard. The owner allows it once, on that Mac: System Settings › Privacy & Security › Accessibility, turn on the entry of the remote login (sshd-keygen-wrapper, or add /usr/libexec/sshd-keygen-wrapper with +). You can put that pane in front of them with equipo_open and target "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility". Tell the owner exactly that; then try again.`;
    case "missing":
      return r.what === "screenshot"
        ? `${did}: ${name} has no program to take a picture of its screen (grim on Wayland, or gnome-screenshot, spectacle, scrot, maim, or ImageMagick's import). Tell the owner which one is missing and offer to install it with equipo_run (for example scrot, or grim on Wayland, with that system's package manager); then try again.`
        : `${did}: ${name} has no ${inlineName(r.what, 20)}, the program that moves the pointer and types there. Tell the owner that and offer to install it with equipo_run using that system's package manager${r.what === "ydotool" ? " (ydotool also needs its service, ydotoold, running)" : ""}; then try again.`;
    case "error":
      return `${did} on ${name}: ${r.detail}`;
  }
}

/** Guarda una captura traída de un equipo como medio del chat; devuelve su id. */
export type SaveShot = (a: { name: string; mime: string; bytes: Buffer; thread?: string | undefined }) => {
  id: string;
};

export function equipoTools(store: Team, save?: SaveShot): Tool[] {
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
  const newId = () => randomBytes(6).toString("hex");
  /** Sube el script si lo hay (Windows) y lanza la orden en la sesión con escritorio; devuelve lo que contestó. */
  const onDesktop = async (ctx: ToolContext, c: TeamComputer, plan: ScreenPlan): Promise<ScreenResult> => {
    if (plan.upload)
      await ctx.call("equipos.write_file", {
        equipo: c.id,
        path: plan.upload.path,
        content_base64: Buffer.from(plan.upload.content, "utf8").toString("base64"),
      });
    const r = await ctx.call("equipos.run", { equipo: c.id, command: plan.command, timeout_s: SCREEN_TIMEOUT_S });
    return parseScreenResult(r.output);
  };
  /** La pantalla de un equipo, vista: la imagen va al modelo y el texto dice cómo pasar de sus píxeles a la pantalla. */
  const shot = async (ctx: ToolContext, c: TeamComputer): Promise<string> => {
    const os_ = guiOs(c.platform);
    const id = newId();
    const name = inlineName(c.name);
    try {
      const r = await onDesktop(ctx, c, screenShotPlan(os_, id));
      if (r.state !== "shot") {
        if (r.state === "done") return `no picture taken on ${name}: the computer answered something else`;
        return screenSay(r, name, "no picture taken", place(store).link);
      }
      const file = await ctx.call("equipos.read_file", { equipo: c.id, path: r.file });
      const bytes = Buffer.from(file.content_base64, "base64");
      const info = file.truncated ? undefined : imageInfo(bytes);
      if (!info?.width || !info.height)
        return `no picture taken on ${name}: the picture did not arrive whole (${file.size} bytes)`;
      if (!save) return `the picture of ${name} was taken but this Colonia cannot keep pictures`;
      const media = save({
        name: info.mime === "image/png" ? "screen.png" : "screen.jpg",
        mime: info.mime,
        bytes,
        thread: ctx.thread.id,
      });
      ctx.see?.({ media_id: media.id, mime: info.mime });
      const k = Math.round((r.width / info.width) * 1000) / 1000;
      const at = (v: number, p: string) => (v ? `${v} + ${p}` : p);
      const map =
        k === 1 && !r.x && !r.y
          ? `the picture is ${info.width}x${info.height} px: its pixel (px,py) is the screen point (px,py)`
          : `the picture is ${info.width}x${info.height} px: its pixel (px,py) is the screen point (${at(r.x, k === 1 ? "px" : `px*${k}`)}, ${at(r.y, k === 1 ? "py" : `py*${k}`)})`;
      return untrusted(
        "screen",
        { equipo: c.name },
        `the whole screen of ${name} (${r.width}x${r.height}), as its user sees it now; ${map}. Give equipo_do screen points. There is no list of elements: read the picture.`,
      );
    } finally {
      // Lo que quede allí (la captura ya leída, un script que no llegó a correr) se borra; si falla, no cambia el resultado.
      await ctx
        .call("equipos.run", { equipo: c.id, command: screenCleanupCommand(os_, id), timeout_s: 30 })
        .catch(() => undefined);
    }
  };
  return [
    // EQUIPO-GUI-1: ver la pantalla de un equipo y manejarla.
    defineTool({
      name: "equipo_screenshot",
      description:
        "See the screen of one of the owner's other computers as whoever is signed in there sees it now: you get the picture and how its pixels map to screen points for equipo_do. If it cannot (nobody signed in, screen locked, a permission or a program missing there), it says exactly what is missing: tell the owner that.",
      args: z.object({ equipo }),
      effect: "external",
      confirm: "untrusted",
      needsCap: EQUIPO_CAP,
      deadlineMs: 300_000,
      ...card("equipo_screenshot"),
      explain: (a) => `Ver la pantalla de «${a.equipo}»`,
      title: (a) => `Miró la pantalla de ${a.equipo ?? "un equipo"}`,
      run: (a, ctx) => shot(ctx, need(a.equipo)),
    }),
    defineTool({
      name: "equipo_do",
      description:
        'Click, press keys and type on the screen of one of the owner\'s other computers, several steps in a row, then see the screen again. Same steps as screen_do: a click at a screen point taken from equipo_screenshot (it moves that computer\'s pointer: its user sees it), keys ("enter", "tab", "esc", "ctrl+l", "cmd+space", arrows, "pagedown", "f5") or text typed into the focused field (never passwords or payment data). Put every step you can predict in one call; it stops at the first that fails and says which.',
      args: z.object({
        equipo,
        steps: z
          .array(
            z.object({
              do: z.enum(["click", "key", "type"]),
              x: z.number().int().optional(),
              y: z.number().int().optional(),
              keys: z.string().min(1).max(40).optional(),
              text: z.string().min(1).max(SCREEN_TEXT_MAX).optional(),
            }),
          )
          .min(1)
          .max(SCREEN_STEPS_MAX)
          .describe("click takes x and y, key takes keys, type takes text"),
        look: z.boolean().optional().describe("see the screen after the last step (default true)"),
      }),
      effect: "external",
      confirm: "always",
      needsCap: EQUIPO_CAP,
      deadlineMs: 500_000,
      ...card("equipo_do"),
      check(a) {
        need(a.equipo);
        const os_ = guiOs(resolveEquipo(store.team.list(), a.equipo)?.platform ?? "");
        // Los pasos se validan antes de pedir permiso: una tecla desconocida no llega a la tarjeta.
        screenDoPlan(os_, steps(a.steps), "check");
      },
      explain: (a) => `En la pantalla de «${a.equipo}»: ${stepsText(a.steps)}`,
      title: (a) => `En ${a.equipo ?? "un equipo"}: ${stepsText(a.steps)}`.slice(0, 160),
      async run(a, ctx) {
        const c = need(a.equipo);
        const os_ = guiOs(c.platform);
        const id = newId();
        const name = inlineName(c.name);
        let r: ScreenResult;
        try {
          r = await onDesktop(ctx, c, screenDoPlan(os_, steps(a.steps), id));
        } finally {
          if (os_ === "windows")
            await ctx
              .call("equipos.run", { equipo: c.id, command: screenCleanupCommand(os_, id), timeout_s: 30 })
              .catch(() => undefined);
        }
        if (r.state === "shot") return `nothing was done on ${name}: the computer answered something else`;
        if (r.state !== "done") return screenSay(r, name, "nothing was done", place(store).link);
        const did = `did ${r.steps} step${r.steps === 1 ? "" : "s"} on the screen of ${name}: ${stepsText(a.steps)}`;
        if (a.look === false) return `${did}\ntake an equipo_screenshot to check it worked`;
        // Una pausa corta deja que la app se repinte antes de mirar.
        await new Promise((res) => setTimeout(res, 400));
        return `${did}\nthe screen now:\n${await shot(ctx, c)}`;
      },
    }),
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
    // EQUIPO-GUI-1: abrir algo donde el usuario del equipo lo ve, y decir claro por qué no cuando no se puede.
    defineTool({
      name: "equipo_open",
      description:
        "Open an app, a file or a web address on the visible desktop of one of the owner's other computers, in front of whoever is signed in there, and check it is still running. Use this, never equipo_run, whenever something must appear on that computer's screen: a window started with equipo_run runs where nobody sees it and still ends without error. target is a program name or path (calc, notepad, \"Google Chrome\" on a Mac), a file or folder path, or a URL. If nobody is signed in there, it says so: tell the owner exactly that.",
      args: z.object({
        equipo,
        target: z.string().min(1).max(GUI_TARGET_MAX).describe("Program, file path or URL to open"),
        args: z
          .array(z.string().max(GUI_ARGS_MAX))
          .max(12)
          .optional()
          .describe("Arguments for the program, one per item"),
      }),
      effect: "external",
      confirm: "ask",
      needsCap: EQUIPO_CAP,
      deadlineMs: 200_000,
      ...card("equipo_open"),
      explain: (a) => `Abrir ${a.target} en la pantalla de «${a.equipo}»`,
      title: (a) => `Abrió ${String(a.target ?? "algo").slice(0, 60)} en ${a.equipo ?? "un equipo"}`,
      async run(a, ctx) {
        const c = need(a.equipo);
        const command = guiOpenCommand(
          guiOs(c.platform),
          { target: a.target, ...(a.args?.length ? { args: a.args } : {}) },
          randomBytes(6).toString("hex"),
        );
        const r = await ctx.call("equipos.run", { equipo: c.id, command, timeout_s: GUI_TIMEOUT_S });
        return guiSay(parseGuiResult(r.output), inlineName(c.name), inlineName(a.target, 80), place(store).link);
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
