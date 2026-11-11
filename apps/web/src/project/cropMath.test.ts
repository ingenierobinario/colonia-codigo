import assert from "node:assert/strict";
import { test } from "node:test";
import { centredCrop, clampCrop, cropRect, panBy, viewBox, ZOOM_MAX, zoomTo } from "./cropMath.ts";

const wide = { w: 800, h: 400 };

test("a new crop takes the middle square of the picture", () => {
  assert.deepEqual(cropRect(wide, centredCrop(wide)), { x: 200, y: 0, side: 400 });
  assert.deepEqual(cropRect({ w: 300, h: 900 }, centredCrop({ w: 300, h: 900 })), { x: 0, y: 300, side: 300 });
});

test("the square never leaves the picture, however far it is dragged", () => {
  const far = panBy(wide, centredCrop(wide), -100_000, 50, 200);
  assert.deepEqual(cropRect(wide, far), { x: 400, y: 0, side: 400 });
  const back = panBy(wide, far, 100_000, 0, 200);
  assert.deepEqual(cropRect(wide, back), { x: 0, y: 0, side: 400 });
});

test("dragging moves the picture with the pointer, at the scale it is shown", () => {
  // 400 picture pixels in a 200 pixel view: one pixel of drag is two of the picture.
  const moved = panBy(wide, centredCrop(wide), 30, 0, 200);
  assert.equal(moved.cx, 340);
  const zoomed = panBy(wide, zoomTo(wide, centredCrop(wide), 2), 30, 10, 200);
  assert.equal(zoomed.cx, 370);
  assert.equal(zoomed.cy, 190);
});

test("zoom stays between once and four times, and zooming out pulls the square back in", () => {
  assert.equal(zoomTo(wide, centredCrop(wide), 9).zoom, ZOOM_MAX);
  assert.equal(zoomTo(wide, centredCrop(wide), 0.2).zoom, 1);
  const corner = panBy(wide, zoomTo(wide, centredCrop(wide), 4), -100_000, -100_000, 200);
  assert.deepEqual(cropRect(wide, corner), { x: 700, y: 300, side: 100 });
  assert.deepEqual(cropRect(wide, zoomTo(wide, corner, 1)), { x: 400, y: 0, side: 400 });
});

test("a crop from elsewhere is brought inside the picture", () => {
  assert.deepEqual(clampCrop(wide, { cx: -5, cy: 9999, zoom: 2 }), { cx: 100, cy: 300, zoom: 2 });
});

test("the picture is laid out in the view so the square fills it", () => {
  assert.deepEqual(viewBox(wide, centredCrop(wide), 200), { left: -100, top: 0, width: 400 });
  assert.deepEqual(viewBox(wide, zoomTo(wide, centredCrop(wide), 2), 200), { left: -300, top: -100, width: 800 });
});
