// EQUIPO-GUI-2 · PowerShell no distingue mayúsculas en los nombres de variable: un `$o` del bucle de GetOwner pisaba
// `$O` (el archivo de respuesta) y abrir una app en otro PC fallaba con «Replace sobre un resultado de GetOwner». Cada
// script de Windows generado no puede usar dos variables que solo se diferencien en mayúsculas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { windowsGuiScript } from "./gui.ts";
import { windowsDesktopScript, windowsDoInner, windowsShotInner } from "./pantalla.ts";

const ID = "ab12cd34ef56";
function collisions(ps: string): string[][] {
  const seen = new Map<string, Set<string>>();
  for (const m of ps.matchAll(/(?<![`\\])\$([A-Za-z_]\w*)/g)) {
    const name = m[1] ?? "";
    const k = name.toLowerCase();
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)?.add(name);
  }
  return [...seen.values()].filter((s) => s.size > 1).map((s) => [...s]);
}

test("ningún script de Windows mezcla variables que solo difieren en mayúsculas", () => {
  const scripts = {
    abrir: windowsGuiScript({ target: "calc.exe", args: ["a b"] }, ID),
    escritorioCaptura: windowsDesktopScript(ID, true),
    escritorioAcciones: windowsDesktopScript(ID, false),
    captura: windowsShotInner(ID),
    acciones: windowsDoInner(
      [
        { do: "click", x: 1, y: 2 },
        { do: "type", text: "hola" },
        { do: "key", keys: "ctrl+a" },
      ],
      ID,
    ),
  };
  for (const [name, ps] of Object.entries(scripts)) assert.deepEqual(collisions(ps), [], name);
});
