import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { bundlePlace, replaceableBundle, saveInFirst } from "./app-bundle.ts";

const all = () => true;

test("the app replaces its own bundle where the owner can write it", () => {
  assert.equal(replaceableBundle("/Applications/Colonia.app/Contents/MacOS/Colonia", all), "/Applications/Colonia.app");
  assert.equal(
    replaceableBundle("/Users/acme/Applications/Colonia 2.app/Contents/MacOS/Colonia", all),
    "/Users/acme/Applications/Colonia 2.app",
  );
});

test("not from a disk image, a translocated copy, a read-only place or a bare binary", () => {
  assert.equal(
    replaceableBundle("/Applications/Colonia.app/Contents/MacOS/Colonia", (dir) => dir !== "/Applications"),
    undefined,
  );
  assert.equal(
    replaceableBundle("/private/var/folders/x/AppTranslocation/1234/d/Colonia.app/Contents/MacOS/Colonia", all),
    undefined,
  );
  assert.equal(replaceableBundle("/usr/local/bin/colonia", all), undefined);
});

test("the app knows why it cannot replace itself: a temporary copy, its disk image, or a folder it cannot write", () => {
  const none = () => false;
  assert.equal(bundlePlace("/Applications/Colonia.app/Contents/MacOS/Colonia", all), "ok");
  assert.equal(
    bundlePlace("/private/var/folders/x/AppTranslocation/1234/d/Colonia.app/Contents/MacOS/Colonia", all),
    "translocated",
  );
  assert.equal(bundlePlace("/Volumes/Colonia 2.3.0/Colonia.app/Contents/MacOS/Colonia", none), "disk-image");
  // An external disk the owner can write is a place like any other.
  assert.equal(bundlePlace("/Volumes/disk/Apps/Colonia.app/Contents/MacOS/Colonia", all), "ok");
  assert.equal(bundlePlace("/Applications/Colonia.app/Contents/MacOS/Colonia", none), "read-only");
  assert.equal(
    bundlePlace("/Applications/Colonia.app/Contents/MacOS/Colonia", (dir) => dir === "/Applications"),
    "read-only",
    "the folder is writable, the app itself is another account's",
  );
  assert.equal(bundlePlace("/usr/local/bin/colonia", all), "none");
});

const refusal = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });

test("an installer the system keeps out of Downloads is saved in the next folder instead", async () => {
  const tried: string[] = [];
  const file = await saveInFirst(["/home/owner/Downloads", "/tmp/colonia"], "Colonia.dmg", async (to) => {
    tried.push(to);
    if (to.includes("Downloads")) throw refusal("EPERM");
  });
  assert.equal(file, path.join("/tmp/colonia", "Colonia.dmg"));
  assert.deepEqual(tried, [path.join("/home/owner/Downloads", "Colonia.dmg"), file]);
});

test("a download that fails for another reason is not tried elsewhere, and one refused everywhere says so", async () => {
  let tries = 0;
  await assert.rejects(
    saveInFirst(["/a", "/b"], "Colonia.dmg", async () => {
      tries++;
      throw new Error("Colonia.dmg does not match its .sha256");
    }),
    /does not match its \.sha256/,
  );
  assert.equal(tries, 1);
  await assert.rejects(
    saveInFirst(["/a", "/b"], "Colonia.dmg", async (to) => {
      throw refusal(to === path.join("/a", "Colonia.dmg") ? "EPERM" : "EACCES");
    }),
    { code: "EACCES" },
  );
});
