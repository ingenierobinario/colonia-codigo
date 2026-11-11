// Where a project's tile is drawn: its initial, an emoji, an icon or a picture cut to a square, on a color.
import "../styles/project-mark.css";
import { PROJECT_ICONS, PROJECT_IMAGE_BYTES, type ProjectTone } from "@colonia/protocol";
import { Button, Dialog, Icons, Input, ProjectTile, SegmentedControl } from "@colonia/ui";
import { PROJECT_GLYPHS } from "@colonia/ui/project-glyphs";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { ProjectAvatar } from "../common/ProjectAvatar.tsx";
import { upload } from "../data/composer.ts";
import { type ProjectEntry, projectInitial, projectTone } from "../data/identity.ts";
import { setProjectMark } from "../data/projects.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { cleanupTaskUpload } from "../tasks/draftAttachments.ts";
import { type Crop, centredCrop } from "./cropMath.ts";
import { CropImage, type CropSource, cropToBlob, ImageCropper, loadPicture } from "./ImageCropper.tsx";
import {
  draftOf,
  firstGrapheme,
  MARK_MODES,
  type MarkDraft,
  type MarkMode,
  markOf,
  PICTURE_TYPES,
  PROJECT_EMOJIS,
  pictureProblem,
} from "./projectMark.ts";

const TONES: readonly ProjectTone[] = ["brand", "violet", "info", "warning", "danger", "ink", "neutral"];
const PREVIEW = 64;
/** One emoji fits: what is typed after the one already there takes its place. */
const typedEmoji = (was: string, value: string) =>
  firstGrapheme(was && value.length > was.length && value.startsWith(was) ? value.slice(was.length) : value);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ProjectMarkEditor({
  project,
  open,
  onOpenChange,
}: {
  project: Pick<ProjectEntry, "id" | "name" | "isDefault">;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const t = useT();
  const saved = useData((s) => (project.isDefault ? s.base.mark : s.projects.find((p) => p.id === project.id)?.mark));
  const [draft, setDraft] = useState<MarkDraft>(() => draftOf(saved));
  const [source, setSource] = useState<CropSource>();
  const [crop, setCrop] = useState<Crop>({ cx: 0, cy: 0, zoom: 1 });
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const emojiId = useId();
  // Filled once per opening: the project list refreshing while it is open must not undo what was chosen.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded) return;
    setDraft(draftOf(saved));
    setSource(undefined);
    setProblem(undefined);
    setSeeded(true);
  }, [open, saved, seeded]);
  useEffect(() => (source ? () => URL.revokeObjectURL(source.url) : undefined), [source]);

  const change = (patch: Partial<MarkDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => onOpenChange(false);
  const tone = draft.tone ?? projectTone(project.id);
  const Glyph = draft.icon ? PROJECT_GLYPHS[draft.icon] : undefined;

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.currentTarget.files?.[0];
    // Emptied so that choosing the same file again is still a change.
    e.currentTarget.value = "";
    if (!chosen) return;
    const why = pictureProblem(chosen);
    if (why) {
      setProblem(t(`project.mark.error.${why}`));
      return;
    }
    try {
      const next = await loadPicture(chosen);
      setSource(next);
      setCrop(centredCrop(next.size));
      setProblem(undefined);
    } catch {
      setProblem(t("project.mark.error.read"));
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    let uploaded: string | undefined;
    try {
      if (draft.mode === "picture" && source) {
        const blob = await cropToBlob(source, crop);
        if (blob.size > PROJECT_IMAGE_BYTES) {
          setProblem(t("project.mark.error.heavy"));
          return;
        }
        const name = blob.type === "image/webp" ? "project-picture.webp" : "project-picture.png";
        uploaded = (await upload(new File([blob], name, { type: blob.type }), undefined, { taskAsset: true })).id;
      }
      if (await setProjectMark(project.id, markOf(draft, uploaded ?? draft.image))) close();
      // Not saved: the picture just uploaded belongs to nothing.
      else if (uploaded) cleanupTaskUpload(uploaded);
    } catch (e) {
      if (uploaded) cleanupTaskUpload(uploaded);
      setProblem(t("project.mark.error.save", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    const done = await setProjectMark(project.id, null);
    setBusy(false);
    if (done) close();
  };

  const incomplete =
    (draft.mode === "emoji" && !draft.emoji) ||
    (draft.mode === "icon" && !draft.icon) ||
    (draft.mode === "picture" && !source && !draft.image);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("project.mark.title", { name: project.name })}
      description={t("project.mark.body")}
      footer={
        <>
          <Button variant="ghost" className="pmark__restore" disabled={busy || !saved} onClick={() => void restore()}>
            {t("project.mark.restore")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button disabled={incomplete} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pmark">
        <div className="pmark__top">
          <div className="pmark__preview">
            {draft.mode === "picture" && source ? (
              <span className="pmark__picture">
                <CropImage source={source} crop={crop} view={PREVIEW} />
              </span>
            ) : draft.mode === "picture" && draft.image ? (
              <ProjectAvatar id={project.id} name={project.name} size={PREVIEW} />
            ) : (
              <ProjectTile
                tone={tone}
                size={PREVIEW}
                initial={projectInitial(project.name)}
                {...(draft.mode === "emoji" && draft.emoji
                  ? { icon: <span style={{ fontSize: Math.round(PREVIEW * 0.62) }}>{draft.emoji}</span> }
                  : {})}
                {...(draft.mode === "icon" && Glyph ? { icon: <Glyph /> } : {})}
              />
            )}
          </div>
          <SegmentedControl
            className="pmark__modes"
            label={t("project.mark.mode")}
            value={draft.mode}
            onValueChange={(v) => {
              change({ mode: v as MarkMode });
              setProblem(undefined);
            }}
            options={MARK_MODES.map((m) => ({ value: m, label: t(`project.mark.mode.${m}`) }))}
          />
        </div>

        {draft.mode === "letter" && <p className="pmark__hint">{t("project.mark.letterBody")}</p>}

        {draft.mode === "emoji" && (
          <>
            <fieldset className="pmark__grid">
              <legend className="pmark__legend">{t("project.mark.emojis")}</legend>
              {PROJECT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="pmark__cell pmark__cell--emoji"
                  aria-pressed={draft.emoji === e}
                  onClick={() => change({ emoji: e })}
                >
                  {e}
                </button>
              ))}
            </fieldset>
            <div className="pmark__other">
              <label htmlFor={emojiId}>{t("project.mark.emojiOther")}</label>
              <Input
                id={emojiId}
                className="pmark__emojiinput"
                value={draft.emoji}
                onChange={(e) => change({ emoji: typedEmoji(draft.emoji, e.currentTarget.value) })}
              />
            </div>
          </>
        )}

        {draft.mode === "icon" && (
          <fieldset className="pmark__grid">
            <legend className="pmark__legend">{t("project.mark.icons")}</legend>
            {PROJECT_ICONS.map((id) => {
              const Icon = PROJECT_GLYPHS[id];
              if (!Icon) return null;
              const label = t(`project.mark.icon.${id}`);
              return (
                <button
                  key={id}
                  type="button"
                  className="pmark__cell"
                  aria-label={label}
                  title={label}
                  aria-pressed={draft.icon === id}
                  onClick={() => change({ icon: id })}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </fieldset>
        )}

        {draft.mode === "picture" && (
          <div className="pmark__pic">
            {source && <ImageCropper source={source} crop={crop} onChange={setCrop} />}
            {!source && <p className="pmark__hint">{t("project.mark.pictureBody")}</p>}
            <input
              ref={file}
              type="file"
              hidden
              accept={PICTURE_TYPES.join(",")}
              aria-label={t("project.mark.choose")}
              onChange={(e) => void choose(e)}
            />
            <Button variant="secondary" leadingIcon={<Icons.Upload size={14} />} onClick={() => file.current?.click()}>
              {source || draft.image ? t("project.mark.replace") : t("project.mark.choose")}
            </Button>
          </div>
        )}

        {problem && (
          <p className="pmark__problem" role="alert">
            {problem}
          </p>
        )}

        {draft.mode !== "picture" && (
          <fieldset className="pmark__tones">
            <legend className="pmark__legend">{t("project.mark.color")}</legend>
            <button
              type="button"
              className="pmark__tone pmark__tone--auto"
              aria-pressed={!draft.tone}
              onClick={() => change({ tone: undefined })}
            >
              {t("project.mark.tone.auto")}
            </button>
            {TONES.map((x) => (
              <button
                key={x}
                type="button"
                className="pmark__tone"
                aria-label={t(`project.mark.tone.${x}`)}
                title={t(`project.mark.tone.${x}`)}
                aria-pressed={draft.tone === x}
                onClick={() => change({ tone: x })}
              >
                <ProjectTile tone={x} size={22} shape="circle" />
              </button>
            ))}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
