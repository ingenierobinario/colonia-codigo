import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NOTA, notaDelPerfil } from "./migrar.ts";

const R = { apps: "Herramientas", sitios: "Otros" };

test("PERFIL-AGENTE-1: la nota junta herramientas reconocidas y sitios sin repetir", () => {
  const n = notaDelPerfil(
    "Webs (Chrome · Trabajo)",
    R,
    [{ name: "Gmail", url: "https://mail.google.com/mail/u/0/" }],
    [{ url: "https://www.notion.so/ws" }, { url: "https://mail.google.com/x" }],
    [{ host: "mail.google.com" }, { host: "github.com" }, { host: "www.notion.so" }],
  );
  assert.equal(
    n,
    "Webs (Chrome · Trabajo). Herramientas: Gmail (https://mail.google.com/mail/u/0/). Otros: github.com, www.notion.so.",
  );
});

test("PERFIL-AGENTE-1: sin nada no hay nota, y nunca pasa del máximo de Memoria", () => {
  assert.equal(notaDelPerfil("X", R, [], [], []), undefined);
  const muchos = Array.from({ length: 400 }, (_, i) => ({ host: `sitio-numero-${i}.example.com` }));
  const n = notaDelPerfil("X", R, [], [], muchos) ?? "";
  assert.ok(n.length <= MAX_NOTA && n.endsWith("."));
});
