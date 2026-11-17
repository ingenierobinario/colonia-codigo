// CURSOR-FIABLE-1 · El clic del agente caía fuera «a veces»: la conversión de píxel de la captura a punto de pantalla
// la hacía el modelo con una fórmula, y esa fórmula era además falsa cuando la ventana se salía de la pantalla.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pictureToScreen, type ScreenMap, windowCrop } from "./screen-map.ts";

/** La fórmula que se le daba al modelo: zona de la VENTANA y escala ancho/píxeles, redondeada a 3 decimales. */
const legacy = (b: { x: number; y: number; width: number }, pxWidth: number, px: number, py: number) => {
  const scale = Number((b.width / pxWidth).toFixed(3));
  return { x: Math.round(b.x + px * scale), y: Math.round(b.y + py * scale) };
};

test("ventana maximizada en Windows (-8,-8): el píxel vuelve al punto donde se capturó", () => {
  // Pantalla 1920x1080 a 125 % (k = 1,25); la ventana maximizada sobresale 8 puntos por cada lado.
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = { x: -8, y: -8, width: 1936, height: 1056 };
  const k = 1.25;
  const got = windowCrop(bounds, display, k, { width: 2400, height: 1350 });
  assert.ok(got);
  assert.deepEqual(got.crop, { x: 0, y: 0, width: 2400, height: 1310 });
  assert.deepEqual(got.region, { x: 0, y: 0, width: 1920, height: 1048 });
  // La captura se reduce a 1600 px de ancho: un botón en el punto (120,500) queda en el píxel (100,416).
  const map: ScreenMap = { ...got.region, px_width: 1600, px_height: 873 };
  const at = pictureToScreen(map, 100, 416);
  assert.ok(Math.abs(at.x - 120) <= 1 && Math.abs(at.y - 500) <= 1, `cayó en ${at.x},${at.y}`);
  // Antes: la misma cuenta con la zona de la ventana se va 7 puntos en x (y hasta 8 en los bordes; en el centro, 0:
  // por eso fallaba solo a veces).
  const old = legacy(bounds, 1600, 100, 416);
  assert.ok(Math.abs(old.x - 120) >= 5, `la fórmula antigua daba ${old.x},${old.y}`);
  assert.equal(legacy(bounds, 1600, 800, 416).x, 960);
});

test("monitor a la izquierda (coordenadas negativas) y pantalla 4K: sin deriva en ningún borde", () => {
  const map: ScreenMap = { x: -3840, y: -200, width: 3840, height: 2160, px_width: 1600, px_height: 900 };
  for (const [px, py] of [
    [0, 0],
    [1599, 899],
    [800, 450],
    [333, 777],
  ] as const) {
    const at = pictureToScreen(map, px, py);
    // El punto está dentro del trozo de pantalla que cubre ese píxel (2,4 puntos de lado).
    assert.ok(at.x >= -3840 + px * 2.4 && at.x <= -3840 + (px + 1) * 2.4, `x de ${px}: ${at.x}`);
    assert.ok(at.y >= -200 + py * 2.4 && at.y <= -200 + (py + 1) * 2.4, `y de ${py}: ${at.y}`);
  }
});

test("un píxel que no está en la captura no hace clic en otra parte: falla", () => {
  const map: ScreenMap = { x: 0, y: 0, width: 1920, height: 1080, px_width: 1600, px_height: 900 };
  assert.throws(() => pictureToScreen(map, 1600, 10), /outside the picture/);
  assert.throws(() => pictureToScreen(map, -1, 10), /outside the picture/);
  assert.throws(() => pictureToScreen(map, 10, Number.NaN), /outside the picture/);
});

test("una ventana entera dentro de la pantalla conserva su zona; una fuera del todo no se recorta", () => {
  const display = { x: 1920, y: 0, width: 2560, height: 1440 };
  const got = windowCrop({ x: 2000, y: 100, width: 800, height: 600 }, display, 2, { width: 5120, height: 2880 });
  assert.deepEqual(got?.region, { x: 2000, y: 100, width: 800, height: 600 });
  assert.equal(
    windowCrop({ x: 9000, y: 100, width: 800, height: 600 }, display, 2, { width: 5120, height: 2880 }),
    undefined,
  );
});
