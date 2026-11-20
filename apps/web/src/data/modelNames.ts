// Model refs and the names people read them under. Pure (no store, no connection), so it is tested on its own.
import type { CatalogEngine, ModelRef } from "@colonia/protocol";

/**
 * "gemini/gemini-3.6-flash" → engine "gemini", model "gemini-3.6-flash"; "claude" → engine only; "#high" at the end
 * is the reasoning effort asked for.
 */
export function splitRef(ref: ModelRef): { engine: string; model?: string; effort?: string; modes?: string[] } {
  const hash = ref.lastIndexOf("#");
  // "#<effort>+<mode>…": the effort may be empty when only a mode is asked ("codex/gpt-6-sol#+fast").
  const [effort, ...rest] = hash > 0 ? ref.slice(hash + 1).split("+") : [];
  const modes = rest.filter(Boolean);
  const base = hash > 0 ? ref.slice(0, hash) : ref;
  const i = base.indexOf("/");
  const parts = i < 0 ? { engine: base } : { engine: base.slice(0, i), model: base.slice(i + 1) };
  return { ...parts, ...(effort ? { effort } : {}), ...(modes.length ? { modes } : {}) };
}

/** The ref without its effort: the model itself. */
export const baseRef = (ref: ModelRef): ModelRef => (ref.includes("#") ? ref.slice(0, ref.lastIndexOf("#")) : ref);

/** What the catalog says of a ref's model (its efforts among it); none for an engine alone or an unknown model. */
export function modelOf(ref: ModelRef, catalog: readonly CatalogEngine[]) {
  const { engine, model } = splitRef(ref);
  return model ? catalog.find((x) => x.id === engine)?.models.find((m) => m.id === model) : undefined;
}

/**
 * NOMBRE-MODELO-1: a model's id in words, for one the catalog gives no name of its own: "claude-opus-5-5" →
 * "Claude Opus 5.5". Short numbers in a row are a version; anything longer (a date) stays apart.
 */
export function readableModelId(id: string): string {
  const words: string[] = [];
  for (const w of id.split(/[-_\s]+/).filter(Boolean)) {
    const last = words[words.length - 1];
    if (/^\d{1,2}$/.test(w) && last && /^\d{1,2}(\.\d{1,2})*$/.test(last)) words[words.length - 1] = `${last}.${w}`;
    else words.push(w === "gpt" ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return words.join(" ") || id;
}

/** A catalog model's name in a list: its own, or its id in words when its engine names it by the id alone. */
export const listedName = (m: { id: string; name: string }): string =>
  m.name !== m.id ? m.name : readableModelId(m.id);

/** A ref's model as people read it: the name its engine gives it, never the raw "engine/model" (NOMBRE-MODELO-1). */
export function modelName(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { model } = splitRef(ref);
  if (!model) return baseRef(ref);
  const known = modelOf(ref, catalog);
  return known ? listedName(known) : readableModelId(model);
}

/**
 * A ref's model for a list or a summary: its name, with its engine only when another engine offers a model of the
 * same name ("Claude Opus 5.5 (OpenRouter)").
 */
export function modelLabel(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { engine } = splitRef(ref);
  const name = modelName(ref, catalog);
  const twin = catalog.some(
    (e) => e.id !== engine && e.models.some((m) => modelName(`${e.id}/${m.id}`, catalog) === name),
  );
  return twin ? `${name} (${catalog.find((x) => x.id === engine)?.label ?? engine})` : name;
}
