import assert from "node:assert/strict";
import { test } from "node:test";
import { addressToUrl } from "./address.ts";

const q = (s: string) => `https://www.google.com/search?q=${encodeURIComponent(s)}`;

test("una dirección se abre: con esquema, sin él, con ruta, localhost e IP", () => {
  assert.equal(addressToUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(addressToUrl("http://example.com"), "http://example.com/");
  assert.equal(addressToUrl("  example.com  "), "https://example.com/");
  assert.equal(addressToUrl("www.google.com/maps"), "https://www.google.com/maps");
  assert.equal(addressToUrl("node.js"), "https://node.js/");
  assert.equal(addressToUrl("localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(addressToUrl("192.168.1.20:8080"), "http://192.168.1.20:8080/");
  assert.equal(addressToUrl("example.com:8443/p"), "https://example.com:8443/p");
});

test("lo que no es una dirección se busca, como en Chrome (antes «test» abría https://test/ y quedaba en blanco)", () => {
  assert.equal(addressToUrl("test"), q("test"));
  assert.equal(addressToUrl("tiempo en madrid"), q("tiempo en madrid"));
  assert.equal(addressToUrl("qué es node.js"), q("qué es node.js"));
  assert.equal(addressToUrl("c++ & rust?"), q("c++ & rust?"));
  assert.equal(addressToUrl("hola:mundo"), q("hola:mundo"));
  assert.equal(addressToUrl("alguien@example.com"), q("alguien@example.com"));
  assert.equal(addressToUrl("version 1.2"), q("version 1.2"));
  assert.equal(addressToUrl("3.14"), q("3.14"));
});

test("vacío o un esquema que el navegador no abre: nada que cargar", () => {
  assert.equal(addressToUrl("   "), undefined);
  assert.equal(addressToUrl("file:///etc/passwd"), undefined);
  assert.equal(addressToUrl("javascript:alert(1)"), undefined);
  assert.equal(addressToUrl("about:blank"), undefined);
  assert.equal(addressToUrl("ftp://example.com/x"), undefined);
});
