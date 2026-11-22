// RUTA-BARRAS-1 · La ruta que llega del otro equipo se traduce a la de este aunque una de las dos carpetas de Colonia
// esté escrita con «/» en Windows; si no, renombrar un proyecto lo duplicaba.
import assert from "node:assert/strict";
import { test } from "node:test";
import { movePath } from "./apply.ts";

const winToWin = {
  fromHome: "C:\\Users\\me\\.colonia",
  toHome: "D:/datos/colonia",
  fromUser: "C:\\Users\\me",
  toUser: "C:\\Users\\luis",
  fromWin: true,
  toWin: true,
};

test("la carpeta de destino escrita con «/» sale con «\\» en Windows", () => {
  assert.equal(
    movePath("C:\\Users\\me\\.colonia\\proyectos\\informe", winToWin),
    "D:\\datos\\colonia\\proyectos\\informe",
  );
});

test("la carpeta de origen escrita con «/» también se reconoce", () => {
  const m = { ...winToWin, fromHome: "c:/users/me/.colonia" };
  assert.equal(movePath("C:\\Users\\me\\.colonia\\proyectos\\informe", m), "D:\\datos\\colonia\\proyectos\\informe");
  assert.equal(movePath("C:/Users/me/.colonia/proyectos/informe", winToWin), "D:\\datos\\colonia\\proyectos\\informe");
});

test("una carpeta que solo empieza igual no se toma por la de Colonia", () => {
  assert.equal(movePath("C:\\Users\\me\\.colonia2\\x", winToWin), "C:\\Users\\luis\\.colonia2\\x");
  assert.equal(movePath("E:\\otra\\x", winToWin), "E:\\otra\\x");
});

test("entre Linux y Windows las barras se pasan en los dos sentidos", () => {
  const m = {
    fromHome: "/home/me/.colonia",
    toHome: "C:/u/.colonia",
    fromUser: "/home/me",
    toUser: "C:\\u",
    fromWin: false,
    toWin: true,
  };
  assert.equal(movePath("/home/me/.colonia/proyectos/a", m), "C:\\u\\.colonia\\proyectos\\a");
  const back = {
    fromHome: "C:/u/.colonia",
    toHome: "/home/me/.colonia",
    fromUser: "C:\\u",
    toUser: "/home/me",
    fromWin: true,
    toWin: false,
  };
  assert.equal(movePath("C:\\u\\.colonia\\proyectos\\a", back), "/home/me/.colonia/proyectos/a");
});
