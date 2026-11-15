// RECETA-1 · Una receta: lo que el agente hizo en un chat, escrito como un SKILL.md que otra persona importa para que
// SU agente lo repita. Cada paso dice qué se hace, sobre qué elemento (por su texto, no por coordenadas) y qué debe
// verse después. Lleva el modo con que se hizo, pero quien la importa vuelve a elegir el suyo.
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import { actedStep } from "./memory-verification.ts";
import { noiseStep, type Places, placesOf, stepGist, unsafe } from "./procedure-steps.ts";
import type { Step } from "./runs.ts";
import type { Store } from "./store.ts";

const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("\n");

export const RECIPE_FORMAT = "colonia-1";
export type RecipeMode = "live" | "background";
export type RecipeStep = {
  /** open, click, key, type, o el nombre de otra herramienta. */
  do: string;
  app?: string;
  /** Para qué es el paso, en palabras de quien lo hizo. */
  goal?: string;
  /** El elemento sobre el que actúa, por su texto o descripción: nunca una coordenada. */
  target?: string;
  /** Lo que se escribe o se pulsa. */
  input?: string;
  /** Lo que debe verse después: si no se ve, el paso no salió. */
  check?: string;
};
export type Recipe = { name: string; description: string; goal: string; mode: RecipeMode; steps: RecipeStep[] };

const KEYS = ["goal", "target", "input", "check"] as const;
const STEPS_MAX = 80;
/** Una línea, sin lo que rompería el formato. */
const line = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
const kept = (v: unknown, max?: number) => {
  const s = line(v, max);
  return s && !unsafe(s) ? s : "";
};
/** Un paso sin campos vacíos (así ida y vuelta dan lo mismo). */
const tidy = (s: RecipeStep): RecipeStep => {
  const out: RecipeStep = { do: s.do };
  if (s.app) out.app = s.app;
  for (const k of KEYS) if (s[k]) out[k] = s[k] as string;
  return out;
};

/** El elemento que no se anotó al hacerlo: quien siga la receta lo busca por el objetivo. */
export const NO_TARGET = "(not recorded: find it from the goal and the picture)";
/** Un texto que no viaja en la receta (podría llevar una credencial): se le pide a la persona. */
export const ASK_INPUT = "(ask the owner for this text)";

type Raw = { do?: unknown; keys?: unknown; text?: unknown; target?: unknown; expect?: unknown };

/** Los pasos de receta que deja una llamada a herramienta; ninguno si solo miró o no dice nada repetible. */
export function recipeSteps(step: Pick<Step, "tool" | "args">, places: Places = {}): RecipeStep[] {
  const a = step.args;
  const goal = kept(a.note, 80);
  if (step.tool === "screen_do" || step.tool === "equipo_do") {
    const app = step.tool === "equipo_do" ? "(another computer)" : kept(a.app, 120);
    const raw = Array.isArray(a.steps) ? (a.steps as Raw[]) : [];
    return raw.flatMap((st) => {
      const kind = st.do === "click" || st.do === "key" || st.do === "type" ? st.do : "";
      if (!kind) return [];
      const typed = line(st.text, 2000);
      const input = kind === "key" ? kept(st.keys, 40) : kind === "type" ? (unsafe(typed) ? ASK_INPUT : typed) : "";
      const target = kept(st.target, 160) || (kind === "click" ? NO_TARGET : "");
      return [tidy({ do: kind, app, goal, target, input, check: kept(st.expect, 160) })];
    });
  }
  if (step.tool === "screen_open") {
    const target = stepGist(step, places);
    const app = kept(a.app, 120);
    return target || app ? [tidy({ do: "open", app, goal, target })] : [];
  }
  const target = stepGist(step, places);
  return target ? [tidy({ do: step.tool, goal, target })] : [];
}

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

/**
 * La receta de un chat: lo que sus últimos turnos hicieron y salió bien, en orden. `undefined` si no hizo nada
 * repetible. `mode` es el modo con que se manejó la pantalla (lo dice quien llama).
 */
export function recipeOf(
  store: Store,
  threadId: string,
  o: { mode: RecipeMode; name?: string | undefined; run?: string | undefined },
): Recipe | undefined {
  const places = placesOf(store, threadId);
  const runs = store.runs
    .list(threadId, 20)
    .filter((r) => !o.run || r.id === o.run)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const steps = runs
    .flatMap((r) => store.runs.steps(r.id))
    .filter((s) => actedStep(s) && !noiseStep(s.tool))
    .flatMap((s) => recipeSteps(s, places))
    .slice(-STEPS_MAX);
  if (!steps.length) return undefined;
  // El objetivo es lo que pidió la persona en el primer turno que hizo algo; si no vale, el título del chat.
  const first = runs.find((r) => store.runs.steps(r.id).some(actedStep));
  const asked = first ? store.memorySources.forRun(first.id)[0] : undefined;
  const message = asked ? store.messages.get(asked) : undefined;
  const said = message ? (textOf(message).trim().split("\n")[0] ?? "") : "";
  const goal =
    kept(said.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1"), 200) ||
    kept(store.threads.get(threadId)?.title, 200) ||
    "Repeat these steps";
  const name = o.name || `receta-${slug(goal) || "sin-nombre"}`;
  return { name, description: `Recipe: ${goal}`.slice(0, 240), goal, mode: o.mode, steps };
}

const HOW = [
  "This is a recipe: steps another Colonia agent did, exported so you can repeat them on this computer.",
  "Do the steps in order. Before each one take a fresh look (screen_snapshot, or equipo_screenshot) and find the target by its text or description in what you see now: positions are different on every computer, so never reuse a coordinate.",
  "After each step, look for its check. If it is not there, do not go on: try the step once more, and if it still fails stop and tell the owner which step failed and what you see.",
  "Whether the real pointer moves (live) or not (in the background) is the owner's choice when they imported this recipe, never yours.",
].join("\n");

/** La receta como SKILL.md. */
export function renderRecipe(r: Recipe): string {
  const steps = r.steps.map((s, i) => {
    const head = `${i + 1}. ${s.do}${s.app ? ` · app: ${s.app}` : ""}`;
    return [head, ...KEYS.flatMap((k) => (s[k] ? [`   - ${k}: ${s[k]}`] : []))].join("\n");
  });
  return [
    "---",
    `name: ${r.name}`,
    `description: ${JSON.stringify(line(r.description, 240))}`,
    `recipe: ${RECIPE_FORMAT}`,
    `mode: ${r.mode}`,
    "---",
    "",
    `# ${line(r.goal)}`,
    "",
    HOW,
    "",
    "## Steps",
    "",
    steps.join("\n"),
    "",
  ].join("\n");
}

const HEAD = /^(\d+)\. ([\w.-]+)(?: · app: (.+))?$/;
const FIELD = /^\s+- (goal|target|input|check): (.+)$/;

/** Lee una receta de su .md; `undefined` si no lo es (otra skill, o un formato que esta versión no conoce). */
export function parseRecipe(text: string): Recipe | undefined {
  const { fields, body } = parseFrontmatter(text);
  if (textField(fields.recipe) !== RECIPE_FORMAT) return undefined;
  const name = textField(fields.name) ?? "";
  const mode = textField(fields.mode) === "background" ? "background" : "live";
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.trim() === "## Steps");
  if (!name || at < 0) return undefined;
  const steps: RecipeStep[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^#/.test(l)) break;
    const h = HEAD.exec(l.trimEnd());
    if (h) {
      steps.push(tidy({ do: h[2] as string, app: h[3]?.trim() ?? "" }));
      continue;
    }
    const f = FIELD.exec(l.trimEnd());
    const last = steps.at(-1);
    if (f && last) last[f[1] as (typeof KEYS)[number]] = (f[2] as string).trim();
  }
  if (!steps.length) return undefined;
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "";
  return {
    name,
    description: (textField(fields.description) ?? "").replace(/\s+/g, " ").trim(),
    goal: title,
    mode,
    steps: steps.slice(0, STEPS_MAX),
  };
}
