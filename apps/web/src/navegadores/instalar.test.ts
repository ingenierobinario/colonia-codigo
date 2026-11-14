// INSTALAR-NAV-1
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportSource } from "../colonia-desktop.d.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { entriesFor, installBusy, installLine, withoutProfile } from "./instalar.ts";

const source = (navegador: string, perfil: string, extra: Partial<ImportSource> = {}) =>
  ({ navegador, perfil, ...extra }) as ImportSource;

test("installed browsers with no profile to pick are offered as themselves, once", () => {
  const sources = [source("chrome", "Default")];
  assert.deepEqual(withoutProfile(["chrome", "opera", "vivaldi", "zen"], sources, []), ["opera", "vivaldi"]);
  assert.deepEqual(withoutProfile(["chrome", "opera", "vivaldi"], sources, [{ browser: "opera" }]), ["vivaldi"]);
  assert.deepEqual(withoutProfile([], sources, []), []);
});

test("a just-installed browser enters the bar: its profiles, or itself when it has none to read", () => {
  const sources = [
    source("firefox", "abc.default", { nombre: "Trabajo", email: "a@b.c" }),
    source("firefox", "def.otro"),
    source("chrome", "Default"),
  ];
  const added = entriesFor("firefox", sources, [], "Principal");
  assert.deepEqual(
    added.map((n) => [n.browser, n.name, n.email]),
    [
      ["firefox", "Trabajo", "a@b.c"],
      ["firefox", "def.otro", undefined],
    ],
  );
  assert.equal(new Set(added.map((n) => n.id)).size, 2);
  // The ones already in the bar are not added twice.
  assert.deepEqual(entriesFor("firefox", sources, added, "Principal"), []);
  assert.equal(entriesFor("firefox", sources, added.slice(0, 1), "Principal").length, 1);

  const opera = entriesFor("opera", sources, [], "Principal");
  assert.deepEqual(
    opera.map((n) => [n.browser, n.name]),
    [["opera", "Principal"]],
  );
  assert.deepEqual(entriesFor("opera", sources, opera, "Principal"), []);
  assert.deepEqual(entriesFor("netscape", sources, [], "Principal"), []);
});

test("every moment of an install has its line, in both languages", () => {
  const moments = [
    { phase: "installing" },
    { phase: "downloading" },
    { phase: "downloading", percent: 40 },
    { phase: "waiting", step: "installer" },
    { phase: "waiting", step: "dmg" },
    { phase: "waiting", step: "package" },
    { phase: "waiting", step: "page" },
    { phase: "done" },
    { phase: "failed" },
  ] as const;
  const keys = moments.map(installLine);
  assert.equal(new Set(keys).size, moments.length, "each moment says something different");
  for (const key of keys) {
    assert.ok((es as Record<string, string>)[key], key);
    assert.ok((en as Record<string, string>)[key], key);
  }
  assert.equal(installLine({ phase: "downloading", percent: 0 }), "navegadores.installDownloadingPct");
  assert.deepEqual(
    [undefined, ...moments].map((m) => installBusy(m)),
    [false, true, true, true, true, true, true, true, false, false],
  );
});
