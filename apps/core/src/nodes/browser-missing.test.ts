import assert from "node:assert/strict";
import { test } from "node:test";
import { browserMissing } from "./browser-missing.ts";

test("a Linux machine whose only browser is a Flatpak is told so, not that it has none", () => {
  const only = (file: string) => (seen: string) => seen === file;
  const system = browserMissing("linux", "/home/u", only("/var/lib/flatpak/exports/bin/org.chromium.Chromium"));
  assert.match(system, /Flatpak[\s\S]*COLONIA_CHROME/);
  const own = browserMissing("linux", "/home/u", only("/home/u/.local/share/flatpak/exports/bin/com.google.Chrome"));
  assert.match(own, /Flatpak/);
  const none = browserMissing("linux", "/home/u", () => false);
  assert.match(none, /^no Chrome, Chromium or Edge on this machine\. Install one/);
  assert.doesNotMatch(none, /Flatpak/);
});

test("other systems keep the short reason and never look for Flatpaks", () => {
  const looked: string[] = [];
  const see = (file: string) => {
    looked.push(file);
    return true;
  };
  assert.equal(browserMissing("darwin", "/Users/u", see), "no Chrome, Chromium or Edge on this machine");
  assert.equal(browserMissing("win32", "/u", see), "no Chrome, Chromium or Edge on this machine");
  assert.deepEqual(looked, []);
});
