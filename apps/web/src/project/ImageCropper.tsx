// The square a project's picture is cut to: drag to move it, zoom with the bar, the buttons or the keyboard.
import { IconButton, Icons } from "@colonia/ui";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { useT } from "../i18n/index.ts";
import { CROP_OUTPUT, type Crop, cropRect, panBy, type Size, viewBox, ZOOM_MAX, ZOOM_MIN, zoomTo } from "./cropMath.ts";

export type CropSource = { url: string; img: HTMLImageElement; size: Size };

const VIEW = 216;
const ZOOM_STEP = 0.25;
/** One press of an arrow key moves the picture this many pixels of the view. */
const KEY_STEP = 12;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-KEY_STEP, 0],
  ArrowRight: [KEY_STEP, 0],
  ArrowUp: [0, -KEY_STEP],
  ArrowDown: [0, KEY_STEP],
};

/** Reads a chosen file as a picture; rejects when the browser cannot draw it. */
export async function loadPicture(file: Blob): Promise<CropSource> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty picture");
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { url, img, size: { w: img.naturalWidth, h: img.naturalHeight } };
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The cropped square as a small file. An animated picture keeps the frame on screen. */
export async function cropToBlob(source: CropSource, crop: Crop): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CROP_OUTPUT;
  canvas.height = CROP_OUTPUT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  const r = cropRect(source.size, crop);
  ctx.drawImage(source.img, r.x, r.y, r.side, r.side, 0, 0, CROP_OUTPUT, CROP_OUTPUT);
  const webp = await encode(canvas, "image/webp", 0.9);
  // A browser that cannot write WebP answers with a PNG, or with nothing.
  const blob = webp?.type === "image/webp" ? webp : await encode(canvas, "image/png");
  if (!blob) throw new Error("no picture");
  return blob;
}

/** The picture laid out in a square of `view` pixels so that the crop fills it. */
export function CropImage({ source, crop, view }: { source: CropSource; crop: Crop; view: number }) {
  const box = viewBox(source.size, crop, view);
  return (
    <span className="pmark__cropbox" style={{ width: view, height: view }}>
      <img src={source.url} alt="" draggable={false} style={{ left: box.left, top: box.top, width: box.width }} />
    </span>
  );
}

export function ImageCropper({
  source,
  crop,
  onChange,
}: {
  source: CropSource;
  crop: Crop;
  onChange(crop: Crop): void;
}) {
  const t = useT();
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const zoom = (to: number) => onChange(zoomTo(source.size, crop, to));

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: e.clientX, y: e.clientY };
    onChange(panBy(source.size, crop, e.clientX - from.x, e.clientY - from.y, VIEW));
  };
  const onPointerUp = () => {
    drag.current = undefined;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const arrow = ARROWS[e.key];
    if (arrow) onChange(panBy(source.size, crop, arrow[0], arrow[1], VIEW));
    else if (e.key === "+" || e.key === "=") zoom(crop.zoom + ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoom(crop.zoom - ZOOM_STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div className="pmark__cropper">
      <button
        type="button"
        className="pmark__crop"
        aria-label={t("project.mark.crop.label")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <CropImage source={source} crop={crop} view={VIEW} />
      </button>
      <div className="pmark__zoom">
        <IconButton
          size="sm"
          label={t("project.mark.zoomOut")}
          icon={<Icons.Minus size={14} />}
          disabled={crop.zoom <= ZOOM_MIN}
          onClick={() => zoom(crop.zoom - ZOOM_STEP)}
        />
        <input
          type="range"
          className="pmark__range"
          aria-label={t("project.mark.zoom")}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={crop.zoom}
          onChange={(e) => zoom(Number(e.currentTarget.value))}
        />
        <IconButton
          size="sm"
          label={t("project.mark.zoomIn")}
          icon={<Icons.Plus size={14} />}
          disabled={crop.zoom >= ZOOM_MAX}
          onClick={() => zoom(crop.zoom + ZOOM_STEP)}
        />
      </div>
      <p className="pmark__hint">{t("project.mark.crop.hint")}</p>
    </div>
  );
}
