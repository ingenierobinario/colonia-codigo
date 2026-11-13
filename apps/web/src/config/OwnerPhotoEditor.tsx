// FOTO-DUENO-1: the owner's profile picture, cut to a centred square and made small here (256 px, WebP) before it is
// uploaded; the core takes it like a project's picture and deletes the one it replaces.
import "../styles/project-mark.css";
import { type OwnerIdentity, PROJECT_IMAGE_BYTES } from "@colonia/protocol";
import { Button, Dialog, Icons } from "@colonia/ui";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { OwnerAvatar } from "../common/OwnerAvatar.tsx";
import { client } from "../data/client.ts";
import { upload } from "../data/composer.ts";
import { rememberOwner } from "../data/owner.ts";
import { useT } from "../i18n/index.ts";
import { type Crop, centredCrop } from "../project/cropMath.ts";
import { CropImage, type CropSource, cropToBlob, ImageCropper, loadPicture } from "../project/ImageCropper.tsx";
import { PICTURE_TYPES, pictureProblem } from "../project/projectMark.ts";
import { cleanupTaskUpload } from "../tasks/draftAttachments.ts";

const PREVIEW = 64;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function OwnerPhotoEditor({
  name,
  photo,
  open,
  onOpenChange,
  onSaved,
}: {
  name: string;
  photo: string | undefined;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(owner: OwnerIdentity): void;
}) {
  const t = useT();
  const [source, setSource] = useState<CropSource>();
  const [crop, setCrop] = useState<Crop>({ cx: 0, cy: 0, zoom: 1 });
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) return;
    setSource(undefined);
    setProblem(undefined);
  }, [open]);
  useEffect(() => (source ? () => URL.revokeObjectURL(source.url) : undefined), [source]);

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

  const apply = async (next: string | null) => {
    const owner = await client.call("owner.set", { photo: next });
    rememberOwner(owner);
    onSaved(owner);
    onOpenChange(false);
  };

  const save = async () => {
    if (busy || !source) return;
    setBusy(true);
    setProblem(undefined);
    let uploaded: string | undefined;
    try {
      const blob = await cropToBlob(source, crop);
      if (blob.size > PROJECT_IMAGE_BYTES) {
        setProblem(t("project.mark.error.heavy"));
        return;
      }
      const ext = blob.type === "image/webp" ? "webp" : "png";
      uploaded = (
        await upload(new File([blob], `owner-photo.${ext}`, { type: blob.type }), undefined, { taskAsset: true })
      ).id;
      await apply(uploaded);
    } catch (e) {
      // Not saved: the picture just uploaded belongs to nothing.
      if (uploaded) cleanupTaskUpload(uploaded);
      setProblem(t("project.mark.error.save", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apply(null);
    } catch (e) {
      setProblem(t("project.mark.error.save", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t("account.photo.title")}
      description={t("account.photo.body")}
      footer={
        <>
          <Button variant="ghost" className="pmark__restore" disabled={busy || !photo} onClick={() => void remove()}>
            {t("account.photo.remove")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!source} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pmark">
        <div className="pmark__pic">
          {source ? (
            <ImageCropper source={source} crop={crop} onChange={setCrop} />
          ) : (
            <>
              <span className="owner-photo-preview">
                {/* The saved picture, or the initials: what the panel shows now. */}
                <OwnerAvatar className="owner-photo-preview__avatar" name={name} />
              </span>
              <p className="pmark__hint">{t("project.mark.pictureBody")}</p>
            </>
          )}
          {source && (
            <span className="owner-photo-preview owner-photo-preview--small" aria-hidden="true">
              <CropImage source={source} crop={crop} view={PREVIEW} />
            </span>
          )}
          <input
            ref={file}
            type="file"
            hidden
            accept={PICTURE_TYPES.join(",")}
            aria-label={t("project.mark.choose")}
            onChange={(e) => void choose(e)}
          />
          <Button variant="secondary" leadingIcon={<Icons.Upload size={14} />} onClick={() => file.current?.click()}>
            {source || photo ? t("project.mark.replace") : t("project.mark.choose")}
          </Button>
        </div>
        {problem && (
          <p className="pmark__problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
