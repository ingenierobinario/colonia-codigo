import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { downloadPath, nextZoom, opensDirectly, originOf, permissionPolicy, shortcut } from "./policy.ts";

test("the browser shortcuts use Ctrl on Windows and Linux and Cmd on macOS", () => {
  assert.equal(shortcut({ key: "f", control: true }, false), "find");
  assert.equal(shortcut({ key: "F", meta: true }, true), "find");
  assert.equal(shortcut({ key: "f", control: true }, true), undefined);
  assert.equal(shortcut({ key: "f", meta: true }, false), undefined);
  assert.equal(shortcut({ key: "f" }, false), undefined);
  assert.equal(shortcut({ key: "=", control: true }, false), "zoom-in");
  assert.equal(shortcut({ key: "+", control: true, shift: true }, false), "zoom-in");
  assert.equal(shortcut({ key: "-", meta: true }, true), "zoom-out");
  assert.equal(shortcut({ key: "0", control: true }, false), "zoom-reset");
  assert.equal(shortcut({ key: "p", control: true }, false), "print");
  assert.equal(shortcut({ key: "r", meta: true }, true), "reload");
  assert.equal(shortcut({ key: "F5" }, false), "reload");
  assert.equal(shortcut({ key: "F12" }, false), "devtools");
  assert.equal(shortcut({ key: "I", control: true, shift: true }, false), "devtools");
  assert.equal(shortcut({ key: "i", meta: true, alt: true }, true), "devtools");
});

test("back and forward: Alt+arrows outside macOS, Cmd+brackets on it", () => {
  assert.equal(shortcut({ key: "ArrowLeft", alt: true }, false), "back");
  assert.equal(shortcut({ key: "ArrowRight", alt: true }, false), "forward");
  assert.equal(shortcut({ key: "ArrowLeft", alt: true }, true), undefined);
  assert.equal(shortcut({ key: "[", meta: true }, true), "back");
  assert.equal(shortcut({ key: "]", meta: true }, true), "forward");
});

test("AltGr characters and shifted letters are never shortcuts", () => {
  assert.equal(shortcut({ key: "f", control: true, alt: true }, false), undefined);
  assert.equal(shortcut({ key: "0", control: true, alt: true }, false), undefined);
  assert.equal(shortcut({ key: "P", control: true, shift: true }, false), undefined);
  assert.equal(shortcut({ key: "r", control: true, shift: true }, false), undefined);
});

test("zoom moves by Chrome's steps and stops at the ends", () => {
  assert.equal(nextZoom(1, "zoom-in"), 1.1);
  assert.equal(nextZoom(1.1, "zoom-in"), 1.25);
  assert.equal(nextZoom(1, "zoom-out"), 0.9);
  assert.equal(nextZoom(5, "zoom-in"), 5);
  assert.equal(nextZoom(0.25, "zoom-out"), 0.25);
  assert.equal(nextZoom(1.7, "zoom-reset"), 1);
  // A factor that came back from Chromium with noise still moves a whole step.
  assert.equal(nextZoom(1.1000000238, "zoom-in"), 1.25);
  assert.equal(nextZoom(0.8999999762, "zoom-out"), 0.8);
});

test("a page gets fullscreen and copy without asking, devices only by asking, and nothing else", () => {
  for (const p of ["fullscreen", "pointerLock", "clipboard-sanitized-write"])
    assert.equal(permissionPolicy(p), "allow");
  for (const p of ["media", "geolocation", "notifications", "clipboard-read"]) assert.equal(permissionPolicy(p), "ask");
  for (const p of ["openExternal", "hid", "serial", "usb", "midiSysex", "display-capture", "unknown"])
    assert.equal(permissionPolicy(p), "deny");
});

test("a permission is remembered per web origin", () => {
  assert.equal(originOf("https://meet.google.com/abc-defg?x=1"), "https://meet.google.com");
  assert.equal(originOf("file:///etc/passwd"), undefined);
  assert.equal(originOf(""), undefined);
  assert.equal(originOf(undefined), undefined);
});

test("a download keeps its name, never leaves the folder and never replaces a file", () => {
  const dir = path.join("x", "Downloads");
  const none = () => false;
  assert.equal(downloadPath(dir, "informe.pdf", none), path.join(dir, "informe.pdf"));
  assert.equal(downloadPath(dir, "../../evil.txt", none), path.join(dir, "evil.txt"));
  assert.equal(downloadPath(dir, "..\\..\\evil.txt", none), path.join(dir, "evil.txt"));
  assert.equal(downloadPath(dir, 'a<b>:"c|?*.txt', none), path.join(dir, "a_b___c___.txt"));
  assert.equal(downloadPath(dir, "", none), path.join(dir, "download"));
  assert.equal(downloadPath(dir, "...", none), path.join(dir, "download"));
  const taken = new Set([path.join(dir, "informe.pdf"), path.join(dir, "informe (1).pdf")]);
  assert.equal(
    downloadPath(dir, "informe.pdf", (f) => taken.has(f)),
    path.join(dir, "informe (2).pdf"),
  );
});

test("a downloaded program is shown in its folder, not run from the notice", () => {
  assert.equal(opensDirectly("informe.pdf"), true);
  assert.equal(opensDirectly("foto.JPG"), true);
  assert.equal(opensDirectly("ChromeSetup.exe"), false);
  assert.equal(opensDirectly("instalar.MSI"), false);
  assert.equal(opensDirectly("googlechrome.dmg"), false);
  assert.equal(opensDirectly("run.sh"), false);
});
