import assert from "node:assert/strict";
import { test } from "node:test";
import { clipToArea, slotToDip } from "./slot.ts";

test("el hueco del panel pasa a DIP según el zoom del panel", () => {
  const css = { x: 260, y: 121, width: 700, height: 600 };
  assert.deepEqual(slotToDip(css, 1), css);
  assert.deepEqual(slotToDip(css, 1.25), { x: 325, y: 151, width: 875, height: 750 });
  assert.deepEqual(slotToDip(css, 1.5), { x: 390, y: 182, width: 1050, height: 900 });
  // Un zoom que no es un número deja el hueco como llegó.
  assert.deepEqual(slotToDip(css, Number.NaN), css);
  assert.deepEqual(slotToDip(css, 0), css);
});

test("los bordes se redondean sin dejar rendija con la barra de al lado", () => {
  // El lateral acaba en 260,4 y la página en 960: a 125 % son 325,5 → 326 y 1200.
  const b = slotToDip({ x: 260.4, y: 120.6, width: 699.6, height: 599.4 }, 1.25);
  assert.deepEqual(b, { x: 326, y: 151, width: 874, height: 749 });
  assert.equal((b?.x ?? 0) + (b?.width ?? 0), 1200);
});

test("lo que no es un rectángulo no es un hueco", () => {
  for (const bad of [null, undefined, "x", {}, { x: 0, y: 0, width: 1 }, { x: Number.NaN, y: 0, width: 1, height: 1 }])
    assert.equal(slotToDip(bad, 1), null);
});

test("la vista nunca sale del área de su ventana", () => {
  const area = { width: 960, height: 700 };
  // Dentro: no se toca.
  assert.deepEqual(clipToArea({ x: 260, y: 121, width: 700, height: 579 }, area), {
    x: 260,
    y: 121,
    width: 700,
    height: 579,
  });
  // Más ancha y más alta que la ventana (la columna desbordada, o la ventana recién encogida): se recorta.
  assert.deepEqual(clipToArea({ x: 260, y: 121, width: 2400, height: 900 }, area), {
    x: 260,
    y: 121,
    width: 700,
    height: 579,
  });
  // Fuera del todo: sin tamaño, y la ventana la deja detrás del panel.
  assert.deepEqual(clipToArea({ x: 1200, y: 800, width: 300, height: 300 }, area), {
    x: 960,
    y: 700,
    width: 0,
    height: 0,
  });
  assert.deepEqual(clipToArea({ x: -40, y: -10, width: 100, height: 100 }, area), {
    x: 0,
    y: 0,
    width: 60,
    height: 90,
  });
});
