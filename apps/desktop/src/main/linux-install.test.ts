import assert from "node:assert/strict";
import { test } from "node:test";
import { linuxInstall, packageCommand } from "./linux-install.ts";

const owner = (which: "dpkg" | "rpm" | "none") => async (command: string) => ({ status: command === which ? 0 : 1 });
const EXE = "/opt/Colonia/colonia";

test("a Linux Colonia knows whether it came from the AppImage, the .deb, the .rpm or something else", async () => {
  assert.equal(
    await linuxInstall({ APPIMAGE: "/home/ana/Colonia.AppImage" }, "/tmp/.mount_x/colonia", owner("none")),
    "appimage",
  );
  assert.equal(await linuxInstall({}, EXE, owner("dpkg")), "deb");
  assert.equal(await linuxInstall({}, EXE, owner("rpm")), "rpm");
  // Unpacked into /opt by hand, or run from an unpacked zip: no package manager owns it.
  assert.equal(await linuxInstall({}, EXE, owner("none")), "other");
  assert.equal(await linuxInstall({}, "/home/ana/colonia/colonia", owner("dpkg")), "other");
  // No dpkg or rpm on the system at all.
  assert.equal(await linuxInstall({}, EXE, async () => ({ status: null })), "other");
});

test("the command that installs the package is the system's own, with the path quoted for the shell", () => {
  assert.equal(
    packageCommand("deb", "/home/ana/Downloads/Colonia-2.4.0-linux-amd64.deb"),
    "sudo apt install '/home/ana/Downloads/Colonia-2.4.0-linux-amd64.deb'",
  );
  assert.equal(packageCommand("rpm", "/home/ana/Mis cosas/C.rpm"), "sudo dnf install '/home/ana/Mis cosas/C.rpm'");
  assert.equal(packageCommand("deb", "/home/o'neil/C.deb"), `sudo apt install '/home/o'\\''neil/C.deb'`);
});
