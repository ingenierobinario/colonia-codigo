// RECETA-1 · Importing a recipe: pick the .md, see what it holds, and choose how it runs HERE (the file's own mode is
// only a suggestion: the person importing always chooses again).
import type { SkillInfo } from "@colonia/protocol";
import { Button, Checkbox, SegmentedControl, Tag } from "@colonia/ui";
import { useRef, useState } from "react";
import { notify } from "../data/notices.ts";
import { importRecipe, type RecipeInfo, type RecipeMode, readRecipe } from "../data/recipes.ts";
import { useT } from "../i18n/index.ts";

/** A recipe is a short text file; anything bigger is not one. */
const RECIPE_MAX = 200_000;

export function useRecipe(projectId: string | undefined, onDone: (s?: SkillInfo) => void) {
  const [file, setFile] = useState<{ name: string; content: string }>();
  const [info, setInfo] = useState<RecipeInfo>();
  const [mode, setMode] = useState<RecipeMode>();
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = async (name: string, content: string) => {
    setBusy(true);
    const got = await readRecipe(content, projectId);
    setBusy(false);
    setFile(got ? { name, content } : undefined);
    setInfo(got);
    // Never pre-chosen from the file: the person says it.
    setMode(undefined);
  };
  const run = async () => {
    if (!file || !mode) return;
    setBusy(true);
    const r = await importRecipe(file.content, mode, replace, projectId);
    setBusy(false);
    if (r?.saved) onDone(r.skill);
  };
  return { file, info, mode, setMode, replace, setReplace, busy, read, run, ready: Boolean(file && info && mode) };
}

export function RecipeFields({ rec }: { rec: ReturnType<typeof useRecipe> }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > RECIPE_MAX) {
      notify(t("recipe.notRecipe"));
      return;
    }
    void f.text().then((text) => rec.read(f.name, text));
  };
  return (
    <>
      <div className="pform__field">
        <span className="pform__label">{t("res.recipe.file")}</span>
        <div>
          <input
            ref={input}
            type="file"
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              pick(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <Button size="sm" variant="secondary" loading={rec.busy && !rec.info} onClick={() => input.current?.click()}>
            {rec.file?.name ?? t("res.recipe.pick")}
          </Button>
        </div>
        <span className="pform__hint">{t("res.recipe.lead")}</span>
      </div>
      {rec.info && (
        <>
          <div className="pform__field">
            <span className="pform__label">{rec.info.goal || rec.info.name}</span>
            <span className="resv__tags">
              <Tag>{rec.info.name}</Tag>
              <Tag>{t("res.recipe.steps", { n: rec.info.steps })}</Tag>
            </span>
            <span className="pform__hint">
              {t(rec.info.preferred === "live" ? "res.recipe.madeLive" : "res.recipe.madeBackground")}
            </span>
          </div>
          <div className="pform__field">
            <span className="pform__label">{t("res.recipe.mode")}</span>
            <SegmentedControl
              size="sm"
              label={t("res.recipe.mode")}
              // "" matches no option: nothing is selected until the person chooses.
              value={rec.mode ?? ""}
              onValueChange={(v) => rec.setMode(v === "background" ? "background" : "live")}
              options={[
                { value: "live", label: t("desktop.cu.mode.live") },
                { value: "background", label: t("desktop.cu.mode.background") },
              ]}
            />
            <span className="pform__hint">
              {t(
                rec.mode === "live"
                  ? "res.recipe.liveHint"
                  : rec.mode === "background"
                    ? "res.recipe.backgroundHint"
                    : "res.recipe.chooseHint",
              )}
            </span>
          </div>
          <Checkbox checked={rec.replace} label={t("res.recipe.replace")} onCheckedChange={rec.setReplace} />
        </>
      )}
    </>
  );
}
