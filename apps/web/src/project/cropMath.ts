// The square a picture is cut to: where its centre is on the picture and how far in it is zoomed.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** The side of the picture kept, in pixels. */
export const CROP_OUTPUT = 256;

export type Size = { w: number; h: number };
/** Centre of the square in the picture's own pixels; zoom 1 takes the whole short side. */
export type Crop = { cx: number; cy: number; zoom: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The side of the square, in the picture's pixels. */
export function cropSide(size: Size, zoom: number): number {
  return Math.min(size.w, size.h) / clamp(zoom, ZOOM_MIN, ZOOM_MAX);
}

/** The same crop, kept inside the picture and inside the zoom range. */
export function clampCrop(size: Size, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, ZOOM_MIN, ZOOM_MAX);
  const half = cropSide(size, zoom) / 2;
  return { zoom, cx: clamp(crop.cx, half, size.w - half), cy: clamp(crop.cy, half, size.h - half) };
}

export function centredCrop(size: Size): Crop {
  return { cx: size.w / 2, cy: size.h / 2, zoom: ZOOM_MIN };
}

/** The part of the picture to draw: its top-left corner and side, in the picture's pixels. */
export function cropRect(size: Size, crop: Crop): { x: number; y: number; side: number } {
  const c = clampCrop(size, crop);
  const side = cropSide(size, c.zoom);
  return { x: c.cx - side / 2, y: c.cy - side / 2, side };
}

/** Dragging the picture by (dx, dy) pixels of a view `view` pixels wide: the picture follows the pointer. */
export function panBy(size: Size, crop: Crop, dx: number, dy: number, view: number): Crop {
  const perPixel = cropSide(size, crop.zoom) / view;
  return clampCrop(size, { ...crop, cx: crop.cx - dx * perPixel, cy: crop.cy - dy * perPixel });
}

export function zoomTo(size: Size, crop: Crop, zoom: number): Crop {
  return clampCrop(size, { ...crop, zoom });
}

/** Where and how large to draw the whole picture inside a view `view` pixels wide so the crop fills it. */
export function viewBox(size: Size, crop: Crop, view: number): { left: number; top: number; width: number } {
  const r = cropRect(size, crop);
  const scale = view / r.side;
  return { left: (0 - r.x) * scale, top: (0 - r.y) * scale, width: size.w * scale };
}
