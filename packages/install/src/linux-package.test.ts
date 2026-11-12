import assert from "node:assert/strict";
import { test } from "node:test";
import { type PackageRun, packageInstallArgs, packageOwner } from "./linux-package.ts";

const EXE = "/opt/Colonia/colonia";

test("the package that owns /opt/Colonia and its version come from dpkg or rpm themselves", async () => {
  const deb: PackageRun = async (command, args) =>
    command === "dpkg"
      ? { status: 0, stdout: `colonia: ${args[1]}\n` }
      : command === "dpkg-query" && args[2] === "colonia"
        ? { status: 0, stdout: "2.33.0" }
        : { status: null };
  assert.deepEqual(await packageOwner(EXE, deb), { kind: "deb", version: "2.33.0" });
  const rpm: PackageRun = async (command) => (command === "rpm" ? { status: 0, stdout: "2.33.0" } : { status: 1 });
  assert.deepEqual(await packageOwner(EXE, rpm), { kind: "rpm", version: "2.33.0" });
  // A copy nobody owns, or one outside the package's directory, is not a package.
  assert.equal(await packageOwner(EXE, async () => ({ status: 1 })), undefined);
  assert.equal(await packageOwner("/home/ana/Applications/Colonia.AppImage", deb), undefined);
});

test("with privileges the package manager runs without asking", () => {
  assert.deepEqual(packageInstallArgs("deb", "/tmp/C.deb"), ["apt-get", ["install", "-y", "/tmp/C.deb"]]);
  assert.deepEqual(packageInstallArgs("rpm", "/tmp/C.rpm"), ["dnf", ["install", "-y", "/tmp/C.rpm"]]);
});
