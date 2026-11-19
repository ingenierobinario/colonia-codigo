import "../styles/setup.css";
import "../styles/screens.css";
import "../styles/wizard.css";
import type { ModelChoice, ProjectKind } from "@colonia/protocol";
import { AgentAvatar, Badge, Button, IconButton, Icons } from "@colonia/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import logo from "../assets/logo.png";
import { bootstrap } from "../data/actions.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { secretary } from "../data/identity.ts";
import { loadModelsConfig, refLabel, saveModelsConfig, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { updateBase } from "../data/projects.ts";
import { addProject, closeSetup, finishSetup, importV1, scanV1, useSetup, type V1Groups } from "../data/setup.ts";
import { useData } from "../data/state.ts";
import { updateAgent } from "../data/team.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { useDesktopClass } from "../shell/desktop.ts";
import { LanguageMenu } from "../shell/LanguageMenu.tsx";
import { go, useNav } from "../shell/nav.ts";
import { BuildVersion } from "./BuildVersion.tsx";
import { type Draft, defaultDraft } from "./draft.ts";
import { ChannelsStep, DoneStep, EnginesStep, ProjectStep } from "./StepsConfig.tsx";
import { AgentStep, type BringWay, GROUP, ImportStep, Welcome } from "./StepsIntro.tsx";

const STEP_KEY: Record<Step, MessageKey> = {
  welcome: "setup.step.welcome",
  import: "setup.step.import",
  agent: "setup.step.agent",
  engines: "setup.step.engines",
  channels: "setup.step.channels",
  project: "setup.step.project",
  done: "setup.step.done",
};
type Step = "welcome" | "import" | "agent" | "engines" | "channels" | "project" | "done";
/** Steps the owner may leave for later: nothing in them is needed for the crew to work. */
const OPTIONAL: ReadonlySet<Step> = new Set(["channels", "project"]);

/**
 * The first-run setup, the whole window: welcome (start fresh or bring v1), then a few numbered steps (the super-agent's
 * face, the engines, and two that can be skipped: channels and a first project, which also folds memory away), then
 * done. Each step saves as it goes on; the card on the right shows the crew so far.
 */
export function Wizard() {
  const t = useT();
  const lang = useLanguage();
  const mode = useNav((s) => s.mode);
  const desktop = useDesktopClass();
  const status = useSetup((s) => s.status);
  const agents = useData((s) => s.agents);
  const config = useModels((s) => s.config);
  const [d, setD] = useState<Draft>(() => defaultDraft());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<V1Groups>();
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const boss = secretary(agents);

  const steps: Step[] = useMemo(
    () => [
      "welcome",
      ...(d.mode === "import" ? (["import"] as const) : []),
      "agent",
      "engines",
      "channels",
      "project",
      "done",
    ],
    [d.mode],
  );
  const step = steps[at] ?? "welcome";
  // The steps that count for "Step 2 of 4": everything between the welcome and the end.
  const numbered = useMemo(() => steps.filter((s): boolean => s !== "welcome" && s !== "done"), [steps]);
  const number = numbered.indexOf(step) + 1;
  const optional = OPTIONAL.has(step);

  useEffect(() => {
    void loadModelsConfig();
  }, []);
  // The chain starts from what the install has: its default, then the router's fallbacks.
  useEffect(() => {
    if (!config || d.chainSet) return;
    const chain = [config.default.model, ...config.router.chain].filter((m): m is string => Boolean(m));
    setD((cur) => ({ ...cur, chain: [...new Set(chain)], chainSet: true }));
  }, [config, d.chainSet]);
  // The base project as it is now, until the owner names it.
  const base = useData((s) => s.base);
  useEffect(() => {
    if (d.baseSet) return;
    setD((cur) => ({ ...cur, baseName: base.name, baseKind: base.kind ?? "", baseSet: true }));
  }, [base, d.baseSet]);
  // The super-agent as it is now, until the owner changes it.
  useEffect(() => {
    if (!boss || d.nameSet) return;
    setD((cur) => ({ ...cur, name: boss.name, blob: boss.blob ?? "", nameSet: true }));
  }, [boss, d.nameSet]);

  const start = (mode: Draft["mode"]) => {
    const v1 = status?.v1;
    // Importing brings v1's super-agent: the preview shows its name and face from the first step.
    if (mode === "import" && (v1?.agent_name || v1?.agent_blob))
      set({ mode, nameSet: true, name: v1.agent_name ?? d.name, blob: v1.agent_blob ?? d.blob });
    else set({ mode });
    setAt(1);
    if (mode === "import" && !scan) void scanV1().then(setScan);
  };

  const blocked: MessageKey | undefined =
    step === "agent" && !d.blob
      ? "setup.agent.needBlob"
      : step === "agent" && !d.name.trim()
        ? "setup.agent.needName"
        : step === "engines" && !d.chain.length
          ? "setup.engines.needOne"
          : undefined;

  /** What leaving a step saves. */
  const save = async (): Promise<boolean> => {
    if (step === "import") {
      const groups = (scan ?? []).filter((g) => g.count > 0 && d.importOn[g.id] !== false).map((g) => g.id);
      if (!groups.length) return true;
      const r = await importV1(groups);
      if (!r) return false;
      const list = (Object.entries(r.imported) as Array<[keyof typeof GROUP, number]>)
        .map(([k, n]) => `${t(GROUP[k].label)} ${n}`)
        .join(" · ");
      notify(t("setup.import.result", { list }), "info");
      // v1 searched by meaning with these engines: memory starts there too, with v1's choice on skills.
      if (r.imported.embeddings) {
        const now = await client.call("memory.settings", {}).catch(() => undefined);
        set({ memory: "semantic", ...(now ? { skillPicker: now.skill_picker } : {}) });
      }
      // v1's main model and fallbacks came in as the default and the router: the engines step starts from them.
      if (r.imported.keys) {
        await loadModelsConfig();
        set({ chainSet: false });
      }
      if (r.errors.length) notify(t("setup.import.failed", { error: r.errors.join("; ") }));
      // What came in (projects, agents, chats, channels) shows in the panel and the next steps.
      await Promise.all([bootstrap().catch(() => {}), loadChannels()]);
      return true;
    }
    if (step === "agent" && boss) return updateAgent(boss.id, { name: d.name.trim(), blob: d.blob });
    if (step === "engines" && config) {
      const [first, ...rest] = d.chain;
      const choice: ModelChoice = first ? { model: first, router: rest.length > 0 } : { router: true };
      return saveModelsConfig({ default: choice, router: { ...config.router, chain: rest } });
    }
    if (step === "project") {
      try {
        const now = await client.call("memory.settings", {});
        await client.call("memory.set_settings", {
          mode: d.memory,
          skill_picker: d.skillPicker,
          auto_compact: d.compact,
          ...(now.aux_model ? { aux_model: now.aux_model } : {}),
        });
      } catch {}
      const name = d.baseName.trim() || base.name;
      const kind = d.baseKind || null;
      if (name !== base.name || (kind ?? "") !== (base.kind ?? ""))
        if (!(await updateBase({ name, kind: kind as ProjectKind | null }))) return false;
    }
    if (step === "project" && d.projectChoice === "folder" && d.path.trim()) {
      const project = await addProject(d.path.trim());
      if (!project) return false;
      notify(t("setup.project.added", { name: project.name }), "info");
    }
    return true;
  };
  const next = async () => {
    if (blocked || busy) return;
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) setAt((i) => Math.min(i + 1, steps.length - 1));
  };
  // The super-agent's chat opens with its first greeting, in the language on screen.
  const finish = async () => {
    await finishSetup();
    const greeted = await client.call("setup.greet", { language: lang }).catch(() => undefined);
    await bootstrap().catch(() => {});
    go.inboxThread(greeted?.thread ?? "home");
  };

  // MUDANZA-1: their things come from the other computer (linking both, or a backup): the setup ends here and the
  // panel opens on that screen.
  const bring = async (way: BringWay) => {
    await finishSetup();
    go.config(way);
  };

  const name = d.name.trim() || t("setup.preview.unset");
  const body: Record<Step, ReactNode> = {
    welcome: <Welcome v1={status?.v1 ?? null} agent={boss} onStart={start} onBring={(way) => void bring(way)} />,
    import: <ImportStep home={status?.v1?.home ?? "~/.colonia"} scan={scan} draft={d} set={set} />,
    agent: <AgentStep draft={d} set={set} />,
    engines: <EnginesStep draft={d} set={set} />,
    channels: <ChannelsStep name={d.name.trim() || t("agent.super")} />,
    project: <ProjectStep draft={d} set={set} />,
    done: <DoneStep name={name} onFinish={() => void finish()} />,
  };

  return (
    <div className="wiz">
      <header className={`wiz__head${desktop}`}>
        <div className="wiz__brand">
          <img src={logo} alt="" width={24} height={24} />
          <span>Colonia</span>
        </div>
        <nav className="wiz__steps" aria-label={t("setup.menu")}>
          {numbered.map((s, n) => {
            const i = steps.indexOf(s);
            return (
              <button
                key={s}
                type="button"
                className={`wiz__step${i < at ? " is-done" : ""}${i === at ? " is-on" : ""}`}
                aria-current={i === at ? "step" : undefined}
                disabled={i > at}
                onClick={() => setAt(i)}
              >
                <span className="wiz__stepnum">{i < at ? <Icons.Check size={12} /> : n + 1}</span>
                <span className="wiz__steplabel">{t(STEP_KEY[s])}</span>
              </button>
            );
          })}
        </nav>
        <LanguageMenu className="topbar__lang" />
        <IconButton
          size="sm"
          label={mode === "dark" ? t("theme.light") : t("theme.dark")}
          icon={mode === "dark" ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
          onClick={go.toggleMode}
        />
        <button type="button" className="wiz__exit" onClick={closeSetup}>
          {t("setup.exit")}
        </button>
      </header>
      <div className="wiz__scroll">
        <div className={`wiz__grid${step === "welcome" ? " is-single" : ""}`}>
          <div className="wiz__main">
            {number > 0 && (
              <div className="wiz__progress">
                <span className="wiz__stepof">{t("setup.stepOf", { n: number, total: numbered.length })}</span>
                <span className="wiz__meter" aria-hidden="true">
                  <span style={{ width: `${(number / numbered.length) * 100}%` }} />
                </span>
                {optional && <Badge tone="neutral">{t("setup.optional")}</Badge>}
              </div>
            )}
            {body[step]}
            {step !== "welcome" && step !== "done" && (
              <div className="wiz__foot">
                {at > 0 && (
                  <button type="button" className="wiz__back" onClick={() => setAt((i) => Math.max(i - 1, 0))}>
                    {t("setup.back")}
                  </button>
                )}
                <span className="wiz__spacer" />
                {blocked && <span className="wiz__hint">{t(blocked)}</span>}
                {optional && (
                  <Button
                    size="lg"
                    variant="ghost"
                    disabled={busy}
                    title={t("setup.skipHint")}
                    onClick={() => setAt((i) => Math.min(i + 1, steps.length - 1))}
                  >
                    {t("setup.skip")}
                  </Button>
                )}
                <Button size="lg" disabled={Boolean(blocked) || busy} aria-busy={busy} onClick={() => void next()}>
                  {busy
                    ? t(step === "project" ? "setup.createWait" : "setup.choiceWait")
                    : t(step === "project" ? "setup.create" : "setup.next")}
                </Button>
              </div>
            )}
          </div>
          {step !== "welcome" && <Preview draft={d} imports={scan} />}
        </div>
      </div>
      <BuildVersion className={step === "welcome" ? "" : " is-side"} />
    </div>
  );
}

/** The crew so far: its face and name, and one line per part as the steps set it. */
function Preview({ draft: d, imports }: { draft: Draft; imports: V1Groups | undefined }) {
  const t = useT();
  const ready = Boolean(d.blob && d.name.trim());
  const memory: Record<Draft["memory"], MessageKey> = {
    notes: "setup.memory.notes",
    semantic: "setup.memory.semantic",
    off: "setup.memory.off",
  };
  const all = useChannels((s) => s.channels);
  const channels = useMemo(() => all.filter((c) => c.token_set).map((c) => c.label), [all]);
  const catalog = useModels((s) => s.catalog);
  const groups = (imports ?? []).filter((g) => g.count > 0);
  const on = groups.filter((g) => d.importOn[g.id] !== false).length;
  const row = (key: MessageKey, value: ReactNode, mono = false) => (
    <div className="wiz__prow">
      <span className="wiz__pkey">{t(key)}</span>
      <span className={`wiz__pval${mono ? " is-mono" : ""}`}>
        {value || <span className="wiz__unset">{t("setup.preview.unset")}</span>}
      </span>
    </div>
  );
  return (
    <aside className="wiz__preview">
      <div className="wiz__ptop">
        {d.blob ? (
          <AgentAvatar name={d.name || "crew"} blob={d.blob} size={132} status="online" />
        ) : (
          <span className="wiz__pempty">
            <Icons.Plus size={28} />
          </span>
        )}
        {d.name.trim() ? <div className="wiz__pname">{d.name.trim()}</div> : <span className="wiz__pnameempty" />}
        <span className={`wiz__ptag${ready ? " is-ready" : ""}`}>{t("agent.super")}</span>
      </div>
      {row("setup.preview.engines", d.chain.map((ref) => refLabel(ref, catalog)).join(" → "))}
      {row("setup.preview.memory", t(memory[d.memory]))}
      {row("setup.preview.channels", channels.join(", "))}
      {row(
        "setup.preview.projects",
        `${d.baseName.trim() || "Default"}${d.projectChoice === "folder" && d.path.trim() ? ` · ${d.path.trim().split("/").filter(Boolean).at(-1)}` : ""}`,
      )}
      {d.mode === "import" && row("setup.preview.imports", t("setup.preview.groups", { n: on, total: groups.length }))}
    </aside>
  );
}
