import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalHostingDesktop } from "./hostingOffer.ts";
import {
  cloudInvitation,
  forgetPairCode,
  hostingLinks,
  pairKey,
  pairRefusal,
  pendingPairCode,
  serverAddress,
} from "./serverHosting.ts";

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

test("AUTOVINCULAR-1: el código pendiente caduca en un día y se olvida al vincular", () => {
  const bag = new Map<string, string>();
  const store = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  };
  const t0 = 1_000_000;
  assert.equal(pendingPairCode(store, t0), undefined);
  store.setItem("colonia.railway-pair", JSON.stringify({ code: "ABCD2345", at: t0 }));
  assert.equal(pendingPairCode(store, t0 + 60_000), "ABCD2345");
  assert.equal(pendingPairCode(store, t0 + 25 * 3_600_000), undefined);
  assert.equal(bag.size, 0, "uno caducado se borra");
  store.setItem("colonia.railway-pair", JSON.stringify({ code: "ABCD2345", at: t0 }));
  forgetPairCode(store);
  assert.equal(pendingPairCode(store, t0), undefined);
  bag.set("colonia.railway-pair", "{roto");
  assert.equal(pendingPairCode(store, t0), undefined);
});

test("AUTOVINCULAR-1: la dirección del servidor se acepta tal como se copia de Railway, solo por HTTPS", () => {
  assert.equal(serverAddress("colonia-production.up.railway.app"), "https://colonia-production.up.railway.app");
  assert.equal(
    serverAddress(" https://colonia-production.up.railway.app/ "),
    "https://colonia-production.up.railway.app",
  );
  for (const bad of [
    "",
    "http://x.up.railway.app",
    "localhost",
    "x.up.railway.app/ruta",
    "x.app?y=1",
    "https://u:p@x.app",
    "a b",
  ])
    assert.equal(serverAddress(bad), undefined, bad);
});

test("la clave de los registros se acepta como se copie y se rechaza si no es una clave", () => {
  assert.equal(pairKey("abcd-2345"), "ABCD2345");
  assert.equal(pairKey("  ABCD 2345 "), "ABCD2345");
  assert.equal(pairKey("ABCD-2340"), undefined, "sin ceros ni unos, que se confunden");
  assert.equal(pairKey("ABC"), undefined);
  assert.equal(pairKey(""), undefined);
});

test("el motivo del rechazo se lee del error del núcleo y lo desconocido no se inventa", () => {
  assert.equal(pairRefusal({ detail: { refused: "wrong" } }), "wrong");
  assert.equal(pairRefusal({ detail: { refused: "locked" } }), "locked");
  assert.equal(pairRefusal({ detail: { refused: "unreachable" } }), "unreachable");
  assert.equal(pairRefusal({ detail: { refused: "raro" } }), "other");
  assert.equal(pairRefusal(new Error("x")), "other");
  assert.equal(pairRefusal(undefined), "other");
});

test("la dirección del servidor vale sin https:// y con barra final", () => {
  assert.equal(
    serverAddress("colonia-production-a99e7544.up.railway.app"),
    "https://colonia-production-a99e7544.up.railway.app",
  );
  assert.equal(
    serverAddress("https://colonia-production-a99e7544.up.railway.app/"),
    "https://colonia-production-a99e7544.up.railway.app",
  );
  assert.equal(serverAddress("http://colonia.up.railway.app"), undefined);
  assert.equal(serverAddress("colonia"), undefined);
});
