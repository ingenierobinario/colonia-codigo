import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalHostingDesktop } from "./hostingOffer.ts";
import { cloudInvitation, hostingLinks } from "./serverHosting.ts";

test("una plantilla publicada abre el despliegue en Railway", () => {
  const links = hostingLinks("es", "prueba-colonia");
  assert.equal(links.deploy, "https://railway.com/new/template/prueba-colonia?referralCode=dBUtql");
  assert.equal(links.referred, true);
  assert.equal(hostingLinks("es", "prueba-colonia", "").deploy, links.deploy);
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
    assert.equal(links.signup, "https://railway.com/?referralCode=referencia");
    assert.equal(links.referred, true);
    assert.equal(links.guide, "https://colonia.ingenierobinario.com/es/docs/devices/server/");
  }
  assert.equal(hostingLinks("es", undefined, "erróneo&plan=x").signup, "https://railway.com/");
  assert.equal(hostingLinks("en").guide, "https://colonia.ingenierobinario.com/docs/devices/server/");
});

test("cada entrega con paquete ofrece el ZIP que pertenece a esa misma versión", () => {
  for (const version of ["2.36.51", "2.37.0", "3.0.0"]) {
    assert.deepEqual(hostingLinks("es", undefined, undefined, version).files, {
      url: `https://github.com/ingenierobinario/colonia/releases/download/v${version}/colonia-railway-${version}.zip`,
      download: true,
    });
  }
});

test("el desarrollo, las versiones sin ZIP y un valor inválido abren las entregas públicas", () => {
  for (const version of [
    undefined,
    "",
    "0.0.0",
    "2.36.49",
    "2.36.50",
    "2.36.51-dev.4+123abc",
    "2.36.51-rc.1",
    "2.36.51/otro",
  ]) {
    assert.deepEqual(hostingLinks("en", undefined, undefined, version).files, {
      url: "https://github.com/ingenierobinario/colonia/releases",
      download: false,
    });
  }
});

test("el código temporal queda separado del dominio HTTPS que se sincroniza", () => {
  assert.deepEqual(cloudInvitation(" https://prueba.example/  ABCD-2345 "), {
    address: "https://prueba.example",
    code: "ABCD-2345",
  });
  for (const text of [
    "",
    "http://prueba.example ABCD-2345",
    "https://u:p@prueba.example ABCD-2345",
    "https://prueba.example/?clave=x ABCD-2345",
    "https://prueba.example/#ABC ABCD-2345",
    "https://prueba.example 0000-0000",
    "https://prueba.example/sub ABCD-2345",
    "https://prueba.example ABCD-2345 sobra",
  ]) {
    assert.equal(cloudInvitation(text), undefined);
  }
});

test("el escritorio ofrece llevar al servidor solo el motor local confirmado por Electron", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(isLocalHostingDesktop(true, host), true);
    assert.equal(isLocalHostingDesktop(false, host), false);
    assert.equal(isLocalHostingDesktop(undefined, host), false);
  }
  assert.equal(isLocalHostingDesktop(true, "colonia.example"), false);
});
