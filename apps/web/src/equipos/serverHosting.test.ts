import assert from "node:assert/strict";
import { test } from "node:test";
import { hostingLinks } from "./serverHosting.ts";

test("una plantilla publicada abre el despliegue en Railway", () => {
  const links = hostingLinks("es", "prueba-colonia");
  assert.equal(links.deploy, "https://railway.com/new/template/prueba-colonia");
  assert.equal(links.referred, false);
});

test("el enlace aplica la referencia sin cambiar de proveedor ni compartir datos del equipo", () => {
  const links = hostingLinks("en", "Prueba_7", "Invitado-42");
  assert.equal(links.deploy, "https://railway.com/new/template/Prueba_7?referralCode=Invitado-42");
  assert.equal(links.referred, true);
  assert.equal(hostingLinks("es", "prueba", "otro&dato=x").referred, false);
});

test("sin plantilla válida se puede instalar en un servidor siguiendo la guía en el idioma del panel", () => {
  for (const template of [undefined, "", "../login", "https://example.com", "colonia?plan=otro"]) {
    const links = hostingLinks("es", template, "referencia");
    assert.equal(links.deploy, undefined);
    assert.equal(links.referred, false);
    assert.equal(links.guide, "https://colonia.ingenierobinario.com/es/docs/devices/server/");
  }
  assert.equal(hostingLinks("en").guide, "https://colonia.ingenierobinario.com/docs/devices/server/");
});
