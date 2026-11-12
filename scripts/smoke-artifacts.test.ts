import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { appBinary, packageListing, unzipCommand } from "./smoke-artifacts.ts";

test("a .deb and an .rpm are read with their own tool, without installing them", () => {
  assert.deepEqual(packageListing("o/a.deb"), {
    cmd: ["dpkg-deb", ["--contents", "o/a.deb"]],
    app: "./opt/Colonia/colonia",
  });
  assert.deepEqual(packageListing("o/a.rpm"), { cmd: ["rpm", ["-qlp", "o/a.rpm"]], app: "/opt/Colonia/colonia" });
});

test("each OS starts the packaged app by its own executable", () => {
  assert.equal(appBinary({ os: "mac", arch: "arm64" }), path.join("Colonia.app", "Contents", "MacOS", "Colonia"));
  assert.equal(appBinary({ os: "win", arch: "x64" }), "Colonia.exe");
  assert.equal(appBinary({ os: "linux", arch: "x64" }), "colonia");
});

test("a mac zip is unpacked with ditto, which keeps the framework links the signature covers", () => {
  assert.deepEqual(unzipCommand({ os: "mac", arch: "x64" }, "a.zip", "d"), [
    "/usr/bin/ditto",
    ["-x", "-k", "a.zip", "d"],
  ]);
  assert.match(unzipCommand({ os: "win", arch: "x64" }, "a.zip", "d")[0], /System32[\\/]tar\.exe$/);
  assert.equal(unzipCommand({ os: "linux", arch: "arm64" }, "a.zip", "d")[0], "unzip");
});
