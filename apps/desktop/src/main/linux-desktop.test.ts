import assert from "node:assert/strict";
import { test } from "node:test";
import { hasTrayHost, loginCommand, type Probe, sandboxNotice, sandboxText, shortcutRefused } from "./linux-desktop.ts";

const answers =
  (answer: Awaited<ReturnType<Probe>>): Probe =>
  async () =>
    answer;
const absent = answers({ ok: false, missing: false, out: "Error: The name is not activatable" });

test("a tray exists only where something shows tray icons", async () => {
  const never: Probe = async () => {
    throw new Error("other systems are not asked");
  };
  assert.equal(await hasTrayHost("darwin", {}, never), true);
  assert.equal(await hasTrayHost("win32", {}, never), true);
  assert.equal(await hasTrayHost("linux", {}, answers({ ok: true, missing: false, out: "(<true>,)" })), true);
  assert.equal(await hasTrayHost("linux", {}, answers({ ok: true, missing: false, out: "(<false>,)" })), false);
  assert.equal(await hasTrayHost("linux", { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }, absent), false);
  assert.equal(await hasTrayHost("linux", { XDG_CURRENT_DESKTOP: "sway", XDG_SESSION_TYPE: "wayland" }, absent), false);
  // An X11 panel outside GNOME may still show the older kind of tray icon.
  assert.equal(await hasTrayHost("linux", { XDG_CURRENT_DESKTOP: "XFCE", XDG_SESSION_TYPE: "x11" }, absent), true);
  const noTool = answers({ ok: false, missing: true, out: "" });
  assert.equal(await hasTrayHost("linux", { XDG_CURRENT_DESKTOP: "GNOME" }, noTool), false);
  assert.equal(await hasTrayHost("linux", { XDG_CURRENT_DESKTOP: "KDE" }, noTool), true);
});

const reads = (files: Record<string, string>) => ({
  read: (file: string) => files[file],
  exists: (file: string) => file in files,
});

test("running without the sandbox is noticed, with the one command for its cause", () => {
  const off = {
    platform: "linux",
    argv: ["/tmp/.mount_x/colonia", "--no-sandbox"],
    appImage: "/home/u/Applications/Colonia.AppImage",
  };
  assert.equal(sandboxNotice({ ...off, argv: ["/tmp/.mount_x/colonia"], ...reads({}) }), undefined);
  assert.equal(sandboxNotice({ ...off, platform: "win32", ...reads({}) }), undefined);
  assert.deepEqual(sandboxNotice({ ...off, ...reads({}) }), { reason: "switch" });
  assert.deepEqual(sandboxNotice({ ...off, ...reads({ "/proc/sys/kernel/unprivileged_userns_clone": "0\n" }) }), {
    reason: "namespaces",
    command: "sudo sysctl -w kernel.unprivileged_userns_clone=1",
  });
  assert.deepEqual(sandboxNotice({ ...off, ...reads({ "/proc/sys/user/max_user_namespaces": "0\n" }) }), {
    reason: "namespaces",
    command: "sudo sysctl -w user.max_user_namespaces=15000",
  });
  const apparmor = { "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1\n", "/etc/apparmor.d/abi/4.0": "" };
  const notice = sandboxNotice({ ...off, ...reads(apparmor) });
  assert.equal(notice?.reason, "namespaces");
  assert.equal(
    notice?.command,
    `printf '%s\\n' 'abi <abi/4.0>,' 'include <tunables/global>' 'profile colonia-desktop "/home/u/Applications/Colonia.AppImage" flags=(unconfined) {' '  userns,' '}' | sudo tee /etc/apparmor.d/colonia-desktop >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/colonia-desktop`,
  );
  // The fix never asks to turn the restriction off for the whole system, nor to drop the sandbox.
  assert.doesNotMatch(notice?.command ?? "", /apparmor_restrict_unprivileged_userns=0|no-sandbox/);
  const odd = sandboxNotice({ ...off, appImage: "/home/it's/Co*.AppImage", ...reads(apparmor) });
  assert.match(odd?.command ?? "", /"\/home\/it'\\''s\/Co\\\*\.AppImage"/);
  assert.deepEqual(sandboxNotice({ ...off, appImage: undefined, ...reads(apparmor) }), { reason: "namespaces" });
});

test("the sandbox notice speaks both languages and carries the command", () => {
  const notice = { reason: "namespaces" as const, command: "sudo sysctl -w user.max_user_namespaces=15000" };
  assert.match(sandboxText(notice, false).message, /without its sandbox/);
  assert.match(sandboxText(notice, true).message, /sin su aislamiento/);
  assert.ok(sandboxText(notice, false).detail.endsWith(notice.command));
  assert.ok(sandboxText(notice, true).detail.endsWith(notice.command));
  assert.match(sandboxText({ reason: "switch" }, false).detail, /--no-sandbox option/);
  assert.match(sandboxText({ reason: "namespaces" }, true).detail, /guía de instalación/);
});

test("a refused global shortcut on Wayland is not blamed on another app", () => {
  assert.match(
    shortcutRefused("Alt+Space", "linux", { XDG_SESSION_TYPE: "wayland" }, false),
    /Wayland.*keyboard settings/,
  );
  assert.match(
    shortcutRefused("Alt+Space", "linux", { WAYLAND_DISPLAY: "wayland-0" }, true),
    /Wayland.*ajustes de teclado/,
  );
  assert.equal(
    shortcutRefused("Alt+Space", "linux", { XDG_SESSION_TYPE: "x11" }, false),
    "the shortcut Alt+Space is taken by another app",
  );
  assert.equal(
    shortcutRefused("Alt+Space", "win32", { WAYLAND_DISPLAY: "x" }, false),
    "the shortcut Alt+Space is taken by another app",
  );
});

test("starting at login keeps the way the AppImage had to start", () => {
  assert.equal(loginCommand("/home/u/Applications/Colonia.AppImage", {}), '"/home/u/Applications/Colonia.AppImage"');
  assert.equal(
    loginCommand('/home/u/My "Apps"/50%/Colonia.AppImage', { APPIMAGE_EXTRACT_AND_RUN: "1" }),
    'env APPIMAGE_EXTRACT_AND_RUN=1 "/home/u/My \\"Apps\\"/50%%/Colonia.AppImage"',
  );
});
