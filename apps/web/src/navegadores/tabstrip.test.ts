import assert from "node:assert/strict";
import { test } from "node:test";
import { activeOf, adopted, afterClose, blankId, born, isBlank } from "./tabstrip.ts";

test("«+» abre todas las pestañas vacías que se quieran: cada una tiene su id y es la que queda a la vista", () => {
  const real = ["t1"];
  let blanks: string[] = [];
  let picked: string | undefined;
  for (let i = 0; i < 3; i++) {
    const id = blankId();
    blanks = [...blanks, id];
    picked = id;
    assert.equal(activeOf(real, blanks, picked), id);
  }
  assert.equal(new Set(blanks).size, 3);
  assert.ok(blanks.every(isBlank));
  assert.equal(isBlank("t1"), false);
  assert.equal(isBlank(undefined), false);
});

test("la pestaña a la vista es la elegida mientras exista; si no, la primera real o la primera vacía", () => {
  assert.equal(activeOf(["t1", "t2"], ["blank:x"], "t2"), "t2");
  assert.equal(activeOf(["t1", "t2"], ["blank:x"], "blank:x"), "blank:x");
  assert.equal(activeOf(["t1", "t2"], [], "t9"), "t1");
  assert.equal(activeOf([], ["blank:x"], undefined), "blank:x");
  assert.equal(activeOf([], [], "t1"), undefined);
});

test("cerrar la pestaña a la vista pasa a la vecina; cerrar otra no mueve la vista", () => {
  const strip = ["t1", "t2", "blank:a", "blank:b"];
  assert.equal(afterClose(strip, "t2", "t2"), "blank:a");
  assert.equal(afterClose(strip, "blank:b", "blank:b"), "blank:a");
  assert.equal(afterClose(strip, "t1", "blank:a"), "blank:a");
  assert.equal(afterClose(["t1"], "t1", "t1"), undefined);
});

test("al abrir, la vista pasa a la pestaña recién anunciada sin esperar a que cargue", () => {
  assert.equal(adopted(["t1", "t2"], ["t1", "t2"]), undefined);
  assert.equal(adopted(["t1", "t2"], ["t1", "t2", "t3"]), "t3");
  assert.equal(adopted([], ["t7"]), "t7");
  assert.equal(adopted(["t1"], []), undefined);
});

test("la vista sigue a la pestaña que abre la página a la vista, y solo a esa", () => {
  const tabs = [{ tab: "t1" }, { tab: "t2" }, { tab: "t3", opener: "t1" }];
  assert.equal(born(["t1", "t2"], tabs, "t1"), "t3");
  assert.equal(born(["t1", "t2"], tabs, "t2"), undefined);
  assert.equal(born(["t1", "t2", "t3"], tabs, "t1"), undefined);
  assert.equal(born(["t1", "t2"], tabs, undefined), undefined);
});
