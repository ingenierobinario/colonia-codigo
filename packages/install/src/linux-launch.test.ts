import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { failureMessage, fuseCommand, type LinuxHost, launchFailure, mountBlock } from "./appimage.ts";
import { launcherEntry } from "./linux-launch.ts";

const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n';

/** A machine described by the files it has; the AppImage carries the runtime that needs libfuse 2. */
function machine(files: string[], texts: Record<string, string> = {}): LinuxHost {
  return {
    read: (file) => texts[file] ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined),
    exists: (file) => files.includes(file),
    list: (dir) => files.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)),
    head: () => "\x7fELF...libfuse.so.2...",
  };
}

const READY = ["/dev/fuse", "/usr/bin/fusermount", "/usr/lib/x86_64-linux-gnu/libfuse.so.2.9.9"];

test("an AppImage mounts only with the device, the helper and libfuse 2", () => {
  assert.equal(mountBlock(machine(READY), "/a/Colonia.AppImage", {}), undefined);
  assert.deepEqual(mountBlock(machine(["/dev/fuse", "/usr/bin/fusermount3"]), "/a/Colonia.AppImage", {}), {
    device: false,
    helper: true,
    library: true,
  });
  assert.deepEqual(mountBlock(machine(READY.slice(1)), "/a/Colonia.AppImage", {}), {
    device: true,
    helper: false,
    library: false,
  });
  const fromPath = machine(["/dev/fuse", "/opt/bin/fusermount", "/lib64/libfuse.so.2"]);
  assert.equal(mountBlock(fromPath, "/a/Colonia.AppImage", { PATH: "/opt/bin" }), undefined);
  const staticRuntime = { ...machine(["/dev/fuse", "/usr/bin/fusermount3"]), head: () => "static" };
  assert.equal(mountBlock(staticRuntime, "/a/Colonia.AppImage", {}), undefined);
});

test("the fix is one command for the distribution and installs only what is missing", () => {
  const both = { device: false, helper: true, library: true };
  const library = { device: false, helper: false, library: true };
  assert.equal(fuseCommand(UBUNTU, library), "sudo apt install libfuse2t64 || sudo apt install libfuse2");
  assert.equal(fuseCommand(UBUNTU, both), "sudo apt install libfuse2t64 fuse3 || sudo apt install libfuse2 fuse3");
  assert.doesNotMatch(fuseCommand(UBUNTU, both) ?? "", /install (\S+ )*fuse( |$)/);
  assert.equal(fuseCommand("ID=fedora\nVERSION_ID=41\n", library), "sudo dnf install fuse-libs");
  assert.equal(fuseCommand('ID="rocky"\nID_LIKE="rhel centos fedora"\n', both), "sudo dnf install fuse-libs fuse");
  assert.equal(fuseCommand("ID=arch\n", both), "sudo pacman -S fuse2");
  assert.equal(
    fuseCommand('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n', library),
    "sudo zypper install libfuse2",
  );
  assert.equal(fuseCommand("ID=void\n", both), undefined);
  assert.equal(fuseCommand(UBUNTU, { device: true, helper: false, library: false }), undefined);
});

test("a failed start is told apart by what the app printed", () => {
  const fuse = "dlopen(): error loading libfuse.so.2\n\nAppImages require FUSE to run.";
  const sandbox =
    "[78:1111/1:FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox helper binary was found, but is not configured correctly.";
  const display =
    "[13:1111/1:ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:257] Missing X server or $DISPLAY\n[13:1111/1:ERROR:ui/aura/env.cc:246] The platform failed to initialize.  Exiting.";
  const library = "/tmp/x/colonia: error while loading shared libraries: libnss3.so: cannot open shared object file";
  assert.equal(launchFailure(fuse), "mount");
  assert.equal(launchFailure(sandbox), "sandbox");
  assert.equal(launchFailure(display), "display");
  assert.equal(launchFailure(library), "library");
  assert.equal(launchFailure("Segmentation fault"), undefined);
  assert.match(
    failureMessage(fuse, "sudo apt install libfuse2"),
    /cannot mount AppImages[\s\S]*sudo apt install libfuse2/,
  );
  assert.match(failureMessage(library, undefined), /libnss3\.so/);
  assert.match(failureMessage("Segmentation fault", undefined), /It said: Segmentation fault/);
  // Explaining a blocked sandbox never suggests running without it.
  assert.match(failureMessage(sandbox, undefined), /does not open without it/);
  assert.doesNotMatch(failureMessage(sandbox, undefined), /no-sandbox/);
});

test("the menu entry groups under the window, opens files and never carries a sandbox switch", () => {
  const entry = launcherEntry('/home/a b/50%/Co"lonia.AppImage', "/icons/colonia.png", false);
  assert.match(entry, /^Exec="\/home\/a b\/50%%\/Co\\"lonia\.AppImage" %U$/m);
  assert.match(entry, /^StartupWMClass=Colonia$/m);
  assert.match(entry, /^Icon=\/icons\/colonia\.png$/m);
  assert.match(entry, /^Categories=Utility;$/m);
  assert.match(
    entry,
    /^MimeType=application\/x-colonia-artifact;application\/x-colonia-app;application\/x-colonia-extension;$/m,
  );
  assert.doesNotMatch(entry, /no-sandbox/);
  assert.match(
    launcherEntry("/a/C.AppImage", "colonia", true),
    /^Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "\/a\/C\.AppImage" %U$/m,
  );
});
