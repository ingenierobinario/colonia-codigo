import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceableBundle } from "./app-bundle.ts";

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
