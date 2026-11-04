import assert from "node:assert/strict";
import { test } from "node:test";
import { readSurfaceMessage, SURFACE_CSP, surfaceDoc, surfaceResult } from "./surfaceDoc.ts";

test("a surface gets the strict CSP, the mode's colors and the bridge, wherever its HTML starts", () => {
  const bare = surfaceDoc("<p>hi</p>", { mode: "dark", nonce: "n1" });
  assert.match(bare, /^<!doctype html><html><head>/);
  assert.ok(bare.includes(SURFACE_CSP));
  assert.match(bare, /--colonia-bg:#161615/);
  assert.match(bare, /var N="n1"/);
  // The Colonia Kit finds the phone's bridge and starts in its mode; forms run in the page and are never sent.
  assert.match(bare, /setAttribute\("data-ax-mode","dark"\)/);
  assert.match(bare, /window\.colonia=Object\.freeze\(\{host:"colonia",/);
  assert.match(SURFACE_CSP, /form-action 'none'/);
  const full = surfaceDoc("<html><head><title>x</title></head><body></body></html>", { mode: "light", nonce: "n2" });
  assert.match(full, /<head><meta charset="utf-8">/);
  assert.equal(full.match(/<head/g)?.length, 1);
});

test("only this page's prompts, after a real touch, reach the agent", () => {
  const msg = (m: object) => JSON.stringify({ colonia: "n1", kind: "prompt", ...m });
  assert.deepEqual(readSurfaceMessage(msg({ text: " add milk ", gesture: true }), "n1"), { prompt: "add milk" });
  assert.equal(readSurfaceMessage(msg({ text: "spam", gesture: false }), "n1"), undefined);
  assert.equal(readSurfaceMessage(msg({ text: "other page", gesture: true }), "n2"), undefined);
  assert.equal(readSurfaceMessage("not json", "n1"), undefined);
});

test("mobile apps fill the viewport while widgets retain their safe inset", () => {
  const app = surfaceDoc('<main class="colonia-widget">Example</main>', { mode: "dark", nonce: "n", layout: "app" });
  assert.match(app, /--colonia-content-width:none;--colonia-page-padding:0px/);
  const widget = surfaceDoc('<main class="colonia-widget">Example</main>', { mode: "dark", nonce: "n" });
  assert.match(widget, /--colonia-content-width:1100px;--colonia-page-padding:clamp/);
});

test("a page reaches only its own store and database from the phone, under this view's surface id", () => {
  const msg = (m: object) => JSON.stringify({ colonia: "n1", kind: "call", id: 7, ...m });
  assert.deepEqual(
    readSurfaceMessage(msg({ method: "store_get", params: { keys: ["btc"], surface: "x" } }), "n1", "s1"),
    {
      call: { id: 7, method: "surfaces.store_get", params: { keys: ["btc"], surface: "s1" } },
    },
  );
  for (const method of ["fetch", "export", "memory_clear", "surfaces.db_exec", "__proto__"])
    assert.deepEqual(readSurfaceMessage(msg({ method, params: {} }), "n1", "s1"), { refused: 7 }, method);
  assert.deepEqual(readSurfaceMessage(msg({ method: "db_query", params: "x" }), "n1", "s1"), { refused: 7 });
  assert.equal(readSurfaceMessage(msg({ method: "store_get", params: {} }), "n2", "s1"), undefined);
  const page = surfaceDoc("<p>hi</p>", { mode: "light", nonce: "n1" });
  assert.match(page, /window\.colonia=Object\.freeze\(\{host:"colonia",sendPrompt:sendPrompt,call:call,/);
});

test("an answer handed back to the page cannot end the injected script", () => {
  const js = surfaceResult("n1", { id: 3, ok: true, value: { values: { note: "</script><b>" } } });
  assert.doesNotMatch(js, /<\/script/);
  assert.match(js, /^window\.__coloniaResult&&window\.__coloniaResult\("n1",\{"id":3,"ok":true,/);
});
