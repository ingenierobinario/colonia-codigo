import assert from "node:assert/strict";
import { test } from "node:test";
import { pageMenu } from "./page-menu.ts";

const none = { linkURL: "", mediaType: "none" as const, srcURL: "", isEditable: false, selectionText: "" };
const state = { canGoBack: true, canGoForward: false };
const calls: string[] = [];
const actions = {
  openTab: (url: string) => calls.push(`open ${url}`),
  saveUrl: (url: string) => calls.push(`save ${url}`),
  copyImage: () => calls.push("copy-image"),
  copyText: (text: string) => calls.push(`copy ${text}`),
  back: () => calls.push("back"),
  forward: () => calls.push("forward"),
  reload: () => calls.push("reload"),
  print: () => calls.push("print"),
  inspect: () => calls.push("inspect"),
};
const labels = (items: Array<{ type?: string; label?: string }>) =>
  items.map((i) => (i.type === "separator" ? "—" : i.label));

test("an empty spot of a page offers back, forward, reload, print and inspect", () => {
  const { target, page } = pageMenu(none, "es-ES", state, actions);
  assert.deepEqual(target, []);
  assert.deepEqual(labels(page), ["Atrás", "Adelante", "Recargar", "—", "Imprimir…", "—", "Inspeccionar"]);
  assert.equal(page[0]?.enabled, true);
  assert.equal(page[1]?.enabled, false);
});

test("a link opens in a new tab; over it the page's own items leave room", () => {
  const { target, page } = pageMenu({ ...none, linkURL: "https://example.com/a" }, "en-US", state, actions);
  assert.deepEqual(labels(target), ["Open link in new tab"]);
  assert.deepEqual(labels(page), ["Inspect"]);
  (target[0] as { click: () => void }).click();
  assert.equal(calls.at(-1), "open https://example.com/a");
});

test("an image can be opened, saved and copied; a link that is not a web page is not opened", () => {
  const { target } = pageMenu(
    { ...none, linkURL: "javascript:void(0)", mediaType: "image", srcURL: "https://example.com/a.png" },
    "es",
    state,
    actions,
  );
  assert.deepEqual(labels(target), [
    "Abrir imagen en una pestaña nueva",
    "Guardar imagen",
    "Copiar imagen",
    "Copiar dirección de la imagen",
  ]);
  (target[1] as { click: () => void }).click();
  assert.equal(calls.at(-1), "save https://example.com/a.png");
});

test("an image inside the page's own data is saved and copied, not opened", () => {
  const { target } = pageMenu(
    { ...none, mediaType: "image", srcURL: "data:image/png;base64,AAAA" },
    "en",
    state,
    actions,
  );
  assert.deepEqual(labels(target), ["Save image", "Copy image"]);
});

test("over selected text or a text field only inspect is added", () => {
  assert.deepEqual(labels(pageMenu({ ...none, selectionText: "hola" }, "es", state, actions).page), ["Inspeccionar"]);
  assert.deepEqual(labels(pageMenu({ ...none, isEditable: true }, "es", state, actions).page), ["Inspeccionar"]);
});
