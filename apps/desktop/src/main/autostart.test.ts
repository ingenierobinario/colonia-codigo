import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";

const calls: unknown[] = [];
let wasOpenedAtLogin = false;
const native = {
  app: {
    isPackaged: true,
    setLoginItemSettings: (settings: unknown) => calls.push(settings),
    getLoginItemSettings: () => ({ wasOpenedAtLogin }),
  },
};
const key = Symbol.for("colonia.test.autostart");
Object.assign(globalThis, { [key]: native });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('export const app = globalThis[Symbol.for("colonia.test.autostart")].app;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { HIDDEN_ARG, linuxEntry, setLaunchAtLogin, startedAtLogin } = await import("./autostart.ts");
hook.deregister();

function onPlatform(t: { after: (fn: () => void) => void }, platform: NodeJS.Platform) {
  const was = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: platform });
  t.after(() => Object.defineProperty(process, "platform", was));
}

test("the Linux login entry starts Colonia hidden and names its icon", () => {
  const lines = linuxEntry("/home/u/Applications/Colonia.AppImage").split("\n");
  assert.ok(lines.includes('Exec="/home/u/Applications/Colonia.AppImage" --hidden'));
  assert.ok(lines.includes("TryExec=/home/u/Applications/Colonia.AppImage"), "a moved AppImage leaves no dead start");
  assert.ok(lines.includes("Icon=colonia"));
});

test("Windows registers the login item with the hidden flag; macOS without it", (t) => {
  calls.length = 0;
  onPlatform(t, "win32");
  setLaunchAtLogin(true);
  Object.defineProperty(process, "platform", { value: "darwin" });
  setLaunchAtLogin(false);
  assert.deepEqual(calls, [{ openAtLogin: true, args: [HIDDEN_ARG] }, { openAtLogin: false }]);
});

test("Linux writes and removes its autostart entry under XDG_CONFIG_HOME", async (t) => {
  onPlatform(t, "linux");
  const dir = await tempDir("autostart");
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir.path;
  t.after(async () => {
    if (was === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = was;
    await dir.remove();
  });
  const file = path.join(dir.path, "autostart", "colonia.desktop");
  setLaunchAtLogin(true);
  assert.match(fs.readFileSync(file, "utf8"), / --hidden$/m);
  setLaunchAtLogin(false);
  assert.equal(fs.existsSync(file), false);
});

test("a start counts as the login item's from the flag, or from macOS saying so", (t) => {
  onPlatform(t, "win32");
  assert.equal(startedAtLogin(["Colonia.exe", HIDDEN_ARG]), true);
  wasOpenedAtLogin = true;
  assert.equal(startedAtLogin(["Colonia.exe"]), false, "only macOS reports it");
  Object.defineProperty(process, "platform", { value: "darwin" });
  assert.equal(startedAtLogin(["Colonia"]), true);
  wasOpenedAtLogin = false;
  assert.equal(startedAtLogin(["Colonia"]), false);
});
