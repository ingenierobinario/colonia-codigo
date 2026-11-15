// RECETA-1 · Recipes: what an agent did in a chat, saved as a .md another person imports so THEIR agent repeats it.
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";

export type RecipeMode = "live" | "background";
export type RecipeInfo = { name: string; goal: string; preferred: RecipeMode; steps: number };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const where = (project: string | undefined) =>
  project ? { target: "project" as const, project } : { target: "global" as const };

/** Hands the browser a text file to save. */
export function saveTextFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports a chat's steps as `<name>.md` and says how it went. */
export async function exportRecipe(thread: string): Promise<boolean> {
  try {
    const r = await client.call("skills.recipe_export", { thread });
    saveTextFile(`${r.name}.md`, r.content);
    notify(t(r.unnamed ? "recipe.exportedUnnamed" : "recipe.exported", { name: r.name, n: r.steps, m: r.unnamed }));
    return true;
  } catch (e) {
    const error = errText(e);
    notify(error.includes("nothing to export") ? t("recipe.nothing") : t("recipe.exportFailed", { error }));
    return false;
  }
}

/** What a recipe file holds, without saving anything; undefined (and a notice) when it is not a recipe. */
export async function readRecipe(content: string, project?: string): Promise<RecipeInfo | undefined> {
  try {
    const r = await client.call("skills.recipe_import", { content, replace: false, ...where(project) });
    return { name: r.name, goal: r.goal, preferred: r.preferred, steps: r.steps };
  } catch (e) {
    const error = errText(e);
    notify(error.includes("not a Colonia recipe") ? t("recipe.notRecipe") : t("recipe.importFailed", { error }));
    return undefined;
  }
}

/** Saves the recipe as a skill, to be run the way THIS person chose. */
export async function importRecipe(content: string, mode: RecipeMode, replace: boolean, project?: string) {
  try {
    const r = await client.call("skills.recipe_import", { content, mode, replace, ...where(project) });
    notify(t("recipe.imported", { name: r.name }));
    return r;
  } catch (e) {
    const error = errText(e);
    notify(error.includes("already a skill named") ? t("recipe.taken") : t("recipe.importFailed", { error }));
    return undefined;
  }
}
