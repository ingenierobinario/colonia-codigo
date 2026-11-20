import type { CatalogEngine, ModelRef } from "@colonia/protocol";
import { Select, type SelectOption, Switch } from "@colonia/ui";
import {
  baseRef,
  effortLabel,
  listedName,
  modeLabel,
  modelName,
  modelOf,
  splitRef,
  useModels,
  withEffort,
  withMode,
} from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";

/** The models one chain entry can be: its engine's own default, then each chat model the engine offers. */
export function modelOptions(
  ref: ModelRef,
  catalog: readonly CatalogEngine[],
  ownDefault: (engine: string) => string,
): SelectOption[] {
  const { engine } = splitRef(ref);
  const base = baseRef(ref);
  const e = catalog.find((x) => x.id === engine);
  const options: SelectOption[] = [
    { value: engine, label: ownDefault(e?.label ?? engine) },
    ...(e?.models ?? [])
      .filter((m) => m.chat)
      .map((m) => ({ value: `${engine}/${m.id}`, label: listedName(m), ...(m.name !== m.id ? { hint: m.id } : {}) })),
  ];
  // A model the catalog does not list (yet) stays choosable, under a name people can read (NOMBRE-MODELO-1).
  return options.some((o) => o.value === base)
    ? options
    : [...options, { value: base, label: modelName(base, catalog), hint: splitRef(base).model }];
}

/**
 * One entry of a model chain: which of its engine's models, and (when that model takes it) how hard it reasons.
 * The effort travels in the ref ("codex/gpt-6-sol#high").
 */
export function RefSelect({ value, onChange }: { value: ModelRef; onChange(ref: ModelRef): void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const model = modelOf(value, catalog);
  const { effort } = splitRef(value);
  const efforts = model?.efforts ?? [];
  return (
    <span className="refselect">
      <Select
        size="sm"
        className="refselect__model"
        label={t("setup.engines.model")}
        value={baseRef(value)}
        options={modelOptions(value, catalog, (engine) => t("models.engineDefault", { engine }))}
        // Another model starts from its own default effort.
        onValueChange={(v) => v && v !== baseRef(value) && onChange(v)}
      />
      {efforts.length > 0 && (
        <Select
          size="sm"
          className="refselect__effort"
          label={t("models.effort")}
          value={effort ?? ""}
          options={[
            {
              value: "",
              label: model?.default_effort
                ? t("models.effortDefaultIs", { effort: effortLabel(model.default_effort) })
                : t("models.effortDefault"),
            },
            ...efforts.map((e) => ({ value: e, label: effortLabel(e) })),
          ]}
          onValueChange={(v) => onChange(withEffort(value, v || undefined))}
        />
      )}
      <ModeSwitches value={value} onChange={onChange} />
    </span>
  );
}

/**
 * ULTRACODE-1 / VELOCIDAD-1: the engine's own modes the model takes (Claude Code's ultracode, Codex's fast mode), each
 * an on/off switch. They travel in the ref after the effort ("claude/opus#high+ultracode").
 */
export function ModeSwitches({ value, onChange }: { value?: ModelRef | undefined; onChange(ref: ModelRef): void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const modes = (value && modelOf(value, catalog)?.modes) || [];
  if (!value || !modes.length) return null;
  const on = splitRef(value).modes ?? [];
  return (
    <>
      {modes.map((mode) => (
        <Switch
          key={mode}
          size="sm"
          className="mlist__mode"
          label={modeLabel(mode)}
          description={t(`models.modeHint.${mode}` as "models.modeHint.ultracode")}
          checked={on.includes(mode)}
          onCheckedChange={(v) => onChange(withMode(value, mode, v))}
        />
      ))}
    </>
  );
}

/** Below a model list; remains visible when the model has no effort control. */
export function EffortRow({ value, onChange }: { value?: ModelRef; onChange(ref: ModelRef): void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const model = value ? modelOf(value, catalog) : undefined;
  const efforts = model?.efforts ?? [];
  const effort = value ? splitRef(value).effort : undefined;
  return (
    <div className="mlist__effort">
      <span>{t("models.effort")}</span>
      <Select
        size="sm"
        label={t("models.effort")}
        disabled={!efforts.length}
        placeholder={t(value ? "models.effortUnavailable" : "models.effortPickModel")}
        value={effort ?? ""}
        options={
          efforts.length
            ? [
                {
                  value: "",
                  label: model?.default_effort
                    ? t("models.effortDefaultIs", { effort: effortLabel(model.default_effort) })
                    : t("models.effortDefault"),
                },
                ...efforts.map((e) => ({ value: e, label: effortLabel(e) })),
              ]
            : []
        }
        onValueChange={(v) => value && onChange(withEffort(value, v || undefined))}
      />
    </div>
  );
}

/** Below a model list: the effort, then the modes the chosen model takes. */
export function EffortAndModes({ value, onChange }: { value?: ModelRef; onChange(ref: ModelRef): void }) {
  return (
    <>
      <EffortRow value={value} onChange={onChange} />
      <ModeSwitches value={value} onChange={onChange} />
    </>
  );
}
