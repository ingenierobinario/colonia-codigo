import assert from "node:assert/strict";
import { test } from "node:test";
import { type Connectable, findConnectable } from "./find.ts";

const catalog: Connectable[] = ["email", "gmail", "google-drive", "github"].map((id) => ({
  id,
  kind: "integration",
  label: id,
  description: "",
  connected: id === "google-drive",
}));

test("encuentra el servicio por el origen del navegador, incluso con varios servicios del mismo proveedor", () => {
  assert.deepEqual(
    findConnectable(catalog, "https://mail.google.com").map((s) => s.id),
    ["gmail"],
  );
  assert.deepEqual(
    findConnectable(catalog, "https://docs.google.com").map((s) => s.id),
    ["google-drive"],
  );
  assert.deepEqual(
    findConnectable(catalog, "https://github.com").map((s) => s.id),
    ["github"],
  );
});

test("una dirección desconocida no ofrece servicios por palabras de su ruta o de un subdominio engañoso", () => {
  assert.deepEqual(findConnectable(catalog, "https://github.com.example.test/?gmail=1"), []);
  assert.deepEqual(findConnectable(catalog, "https://example.test/github"), []);
});
