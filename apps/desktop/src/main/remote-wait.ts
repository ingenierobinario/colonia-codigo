// A remote Colonia (an address, or one over SSH) the window waits for: the screen says so and it retries until the server
// answers, then loads the panel. A server restarting after an update, or this app restarting, comes back on its own.
import { type PortProblem, portProblem } from "./core-process.ts";
import { PENGUIN_MARK } from "./penguin-mark.ts";
import type { Tunnel } from "./ssh-tunnel.ts";

export type Remote = {
  /** Where, as the screen names it ("ops@box (SSH)"). */
  where: string;
  url: string;
  /** The SSH forward, when there is one. */
  tunnel?: Pick<Tunnel, "alive" | "problem" | "restart">;
  /** The core on this computer: what to check if it never answers (its log, or how to start it). */
  local?: string;
  /** A confirmed identity mismatch, distinct from an unavailable core. */
  identityProblem?: () => string | undefined;
};

export type WaitDeps = {
  /** Still the connection the owner chose (a change of connection ends the wait). */
  current(): boolean;
  isUp(url: string): Promise<boolean>;
  load(url: string): Promise<boolean>;
  /** Puts the waiting text on screen. */
  show(w: Waiting): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  es: boolean;
};

export const RETRY_MS = 1500;
/** A forward that stays up this long with nothing answering through it may be half dead: ssh starts again. */
export const SILENT_MS = 30_000;

/** True once the panel loaded and the connection is still the one asked for. */
export async function reachRemote(remote: Remote, d: WaitDeps): Promise<boolean> {
  const linked = () => remote.tunnel?.alive() ?? true;
  let localDelay = 250;
  let shown: string | undefined;
  let silentSince = d.now();
  const started = d.now();
  while (d.current()) {
    if (!linked()) silentSince = d.now();
    else if (await d.isUp(remote.url)) {
      if (!d.current()) return false;
      if ((await d.load(remote.url)) && linked()) return d.current();
      // A failed load left its own (blank) page: the waiting text goes back on screen.
      shown = undefined;
    } else if (remote.tunnel && d.now() - silentSince >= SILENT_MS) {
      remote.tunnel.restart();
      silentSince = d.now();
    }
    if (!d.current()) return false;
    const now = waiting(remote, linked(), d.es);
    const text = waitingText(now);
    if (text !== shown) {
      shown = text;
      await d.show({ ...now, since: started });
    }
    await d.sleep(remote.local && !remote.identityProblem?.() ? localDelay : RETRY_MS);
    localDelay = Math.min(RETRY_MS, localDelay * 2);
  }
  return false;
}

/** What the waiting screen says, in parts so the page can lay them out. */
export type Waiting = {
  title: string;
  where: string;
  status: string;
  detail?: string;
  hint: string;
  /** What is starting, so the loading screen's words match it. */
  phase: "local" | "remote";
  /** Something is in the way (a port taken, another Colonia, ssh down): the screen says so kindly, details folded. */
  trouble: boolean;
  /** When the wait began (ms since 1970): a redrawn screen keeps its progress instead of starting over. */
  since?: number;
};

export function waiting(remote: Remote, linked: boolean, es: boolean): Waiting {
  const problem = linked ? undefined : remote.tunnel?.problem();
  const identityProblem = remote.identityProblem?.();
  const taken = remote.local ? portProblem(remote.url) : undefined;
  const status =
    identityProblem ??
    (taken ? portTakenText(taken, es) : undefined) ??
    (remote.local
      ? es
        ? "Estamos conectando con tu equipo. Puedes dejar esta ventana abierta mientras Colonia arranca."
        : "Connecting to Colonia on this computer. You can leave this window open while it starts."
      : !remote.tunnel
        ? es
          ? "Esperando que el servidor responda."
          : "Waiting for the server to answer."
        : linked
          ? es
            ? "La conexión SSH está lista. Esperando que Colonia responda en el servidor; puede estar reiniciándose después de una actualización."
            : "The SSH connection is up. Waiting for Colonia on the server to answer; it may be restarting after an update."
          : es
            ? "Esperando la conexión SSH con el servidor. Puede estar reiniciándose o sin red por un momento."
            : "Waiting for the SSH connection to the server. It may be restarting or briefly offline.");
  const detail = problem ?? remote.local;
  return {
    title: es ? "Conectando con Colonia" : "Connecting to Colonia",
    where: remote.where,
    status,
    ...(detail ? { detail } : {}),
    phase: remote.local ? "local" : "remote",
    trouble: Boolean(identityProblem || taken || problem),
    hint: es
      ? "Se abre solo cuando responde. Para elegir otro Colonia: menú Colonia › Cambiar conexión."
      : "It opens by itself once it answers. To pick another Colonia: Colonia menu › Change connection.",
  };
}

/** PUERTO-AJENO-1: another program holds the port Colonia needs on this computer, in plain words with both ways out. */
export function portTakenText(p: PortProblem, es: boolean): string {
  const port = p.freePort ?? p.port + 1;
  if (p.otherHome)
    return es
      ? `En el puerto ${p.port} responde otra instalación de Colonia, no la de esta carpeta. Ciérrala, o haz que esta use otro puerto: añade la línea COLONIA_PORT=${port} al archivo ${p.envFile} y vuelve a abrir Colonia.`
      : `Another Colonia installation, not the one in this folder, answers on port ${p.port}. Close it, or have this one use another port: add the line COLONIA_PORT=${port} to the file ${p.envFile} and open Colonia again.`;
  return es
    ? `Otro programa${p.program ? ` (${p.program})` : ""} está usando el puerto ${p.port}, el que Colonia necesita en este equipo. ` +
        `Ciérralo y Colonia arrancará sola. O haz que Colonia use otro: añade la línea COLONIA_PORT=${port} al archivo ${p.envFile} y vuelve a abrir Colonia.`
    : `Another program${p.program ? ` (${p.program})` : ""} is using port ${p.port}, the one Colonia needs on this computer. ` +
        `Close it and Colonia starts by itself. Or have Colonia use another one: add the line COLONIA_PORT=${port} to the file ${p.envFile} and open Colonia again.`;
}

export function waitingText(w: Waiting): string {
  return [w.title, w.where, w.status, w.detail, w.hint].filter(Boolean).join(" ");
}

const esc = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** CARGA-PINGUINO-1: after this long without an answer, the screen stops promising and says so kindly. */
export const SLOW_MS = 60_000;

/** The words that rotate while Colonia starts: the first one names what is really starting. */
export function loadingSteps(phase: Waiting["phase"], es: boolean): string[] {
  const first =
    phase === "local"
      ? es
        ? ["Despertando a tus agentes…", "Abriendo tus proyectos…"]
        : ["Waking up your agents…", "Opening your projects…"]
      : es
        ? ["Buscando tu Colonia…", "Despertando a tus agentes…"]
        : ["Finding your Colonia…", "Waking up your agents…"];
  return [
    ...first,
    ...(es
      ? ["Preparando tu espacio de trabajo…", "Poniendo todo en orden…", "Casi listo…"]
      : ["Getting your workspace ready…", "Putting everything in place…", "Almost there…"]),
  ];
}

/** BARRA-CLARA-1: the panel's own background (--colonia-bg in packages/ui tokens.css), shared by the loading screen, the window
 * and its Windows/Linux control overlay, so the controls never sit on a box of another color. */
export const SCREEN_BG = { light: "#faf9f7", dark: "#161615" } as const;
export const windowColor = (mode: "light" | "dark") => SCREEN_BG[mode];
export const titleBarColors = (mode: "light" | "dark") => ({
  color: SCREEN_BG[mode],
  symbolColor: mode === "light" ? "#444444" : "#c8c8c8",
  height: 46,
});

/** PINGUINO-OFICIAL-1: Colonia's own mark (the app icon, from scripts/penguins), not a drawing of its own. */
const PENGUIN = PENGUIN_MARK.replace("<svg ", '<svg class="peng" aria-hidden="true" ')
  .replace(' role="img" aria-labelledby="title"', "")
  .replace(/<title[^>]*>[^<]*<\/title>/, "");

/**
 * The waiting screen (CARGA-PINGUINO-1): a loading screen, not a system message. A penguin, words that move forward and a
 * soft progress bar; where it connects, the log and the way to another Colonia stay folded under «See details», shown only
 * when something is in the way or it takes longer than a minute.
 */
export function waitingHtml(w: Waiting, es: boolean): string {
  const t = es
    ? {
        slow: "Está tardando más de lo normal",
        slowSub: "Colonia sigue arrancando. Puedes esperar un poco más; se abrirá sola en cuanto esté lista.",
        stuck: "Colonia no consigue arrancar",
        stuckSub: "Algo le impide abrirse. En los detalles te contamos qué pasa y cómo arreglarlo.",
        details: "Ver detalles",
        change: "Cambiar de conexión",
        where: "Conexión",
        log: "Registro",
      }
    : {
        slow: "This is taking longer than usual",
        slowSub: "Colonia is still starting. You can wait a little longer; it opens by itself as soon as it is ready.",
        stuck: "Colonia can't start",
        stuckSub: "Something is keeping it from opening. The details say what happens and how to fix it.",
        details: "See details",
        change: "Change connection",
        where: "Connection",
        log: "Log",
      };
  const steps = loadingSteps(w.phase, es);
  const data = JSON.stringify({ steps, since: w.since ?? null, slowMs: SLOW_MS, trouble: w.trouble }).replaceAll(
    "<",
    "\\u003c",
  );
  return `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><title>Colonia</title><style>
:root{color-scheme:light dark;--bg:${SCREEN_BG.light};--card:#fff;--fg:#1f1e1c;--muted:#6b6963;--line:#e6e3dc;--accent:#d97757;--track:#ebe8e1}
@media (prefers-color-scheme:dark){:root{--bg:${SCREEN_BG.dark};--card:#232321;--fg:#ecebe7;--muted:#9c9a93;--line:#34332f;--track:#2e2d2a}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;
justify-content:center;padding:48px 16px 16px;-webkit-app-region:drag;user-select:none}
.stage{width:min(420px,100%);text-align:center}
.peng{width:120px;height:120px;display:block;margin:0 auto 18px;overflow:visible;transform-origin:50% 90%;animation:waddle 1.4s ease-in-out infinite}
@keyframes waddle{0%,100%{transform:rotate(-5deg) translateY(0)}25%{transform:rotate(0) translateY(-5px)}50%{transform:rotate(5deg) translateY(0)}75%{transform:rotate(0) translateY(-5px)}}
.brand{font-size:20px;font-weight:650;letter-spacing:-.01em;margin:0 0 6px}
.step{min-height:21px;margin:0 0 18px;color:var(--muted);transition:opacity .35s ease}
.step.out{opacity:0}
.bar{height:6px;border-radius:999px;background:var(--track);overflow:hidden;width:min(280px,100%);margin:0 auto}
.fill{height:100%;width:4%;border-radius:inherit;background:var(--accent);transition:width 1.2s ease-out}
.help{display:none;margin:22px auto 0;width:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;
padding:18px 18px 14px;text-align:left;-webkit-app-region:no-drag}
.slow .help{display:block}
.help h2{font-size:15px;font-weight:600;margin:0 0 4px}
.help p{margin:0 0 10px;color:var(--muted)}
details{border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-weight:600;color:var(--fg);list-style-position:inside}
.facts{margin:10px 0 0;font-size:12px;color:var(--muted);user-select:text}
.facts dt{font-weight:600;color:var(--fg);margin-top:8px}
.facts dd{margin:2px 0 0;font-family:ui-monospace,Menlo,monospace;word-break:break-word}
.facts dd.plain{font-family:inherit}
.change{display:inline-block;margin-top:12px;padding:8px 14px;border-radius:9px;border:1px solid var(--line);
background:var(--bg);color:var(--fg);text-decoration:none;font-weight:600}
.change:hover{border-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.peng{animation:none}.fill,.step{transition:none}}
</style></head><body><main class="stage" role="status" aria-live="polite">
${PENGUIN}
<p class="brand">Colonia</p>
<p class="step" id="step">${esc(steps[0] ?? "")}</p>
<div class="bar" aria-hidden="true"><div class="fill" id="fill"></div></div>
<section class="help" id="help">
<h2>${esc(w.trouble ? t.stuck : t.slow)}</h2><p>${esc(w.trouble ? t.stuckSub : t.slowSub)}</p>
<details><summary>${esc(t.details)}</summary><dl class="facts">
<dt>${esc(w.title)}</dt><dd class="plain">${esc(w.status)}</dd>
<dt>${esc(t.where)}</dt><dd>${esc(w.where)}</dd>
${w.detail ? `<dt>${esc(t.log)}</dt><dd>${esc(w.detail)}</dd>` : ""}
<dd class="plain">${esc(w.hint)}</dd></dl>
<a class="change" href="#colonia-change">${esc(t.change)}</a></details>
</section></main>
<script>(()=>{const d=${data};const since=d.since||Date.now();const step=document.getElementById("step");
const fill=document.getElementById("fill");let shown=-1;
const tick=()=>{const t=Date.now()-since;const i=Math.min(d.steps.length-1,Math.floor(t/2800));
if(i!==shown){shown=i;step.classList.add("out");setTimeout(()=>{step.textContent=d.steps[i];step.classList.remove("out")},shown?300:0)}
fill.style.width=(4+88*(1-Math.exp(-t/14000))).toFixed(1)+"%";
if(d.trouble||t>=d.slowMs)document.body.classList.add("slow")};
tick();setInterval(tick,500)})()</script></body></html>`;
}
