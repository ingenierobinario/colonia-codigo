import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { tempDir, waitFor } from "../../../core/src/testkit/platform.ts";
import type { DesktopUpdate } from "./updater.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-updater-test-"));
const opened: string[] = [];
const shown: string[] = [];
let relaunches = 0;
const native = {
  app: {
    isPackaged: true,
    getVersion: () => "2.0.0",
    getPath: () => directory,
    relaunch: () => {
      relaunches++;
    },
  },
  shell: {
    openPath: async (file: string) => {
      opened.push(file);
      return "No handler";
    },
    showItemInFolder: (file: string) => shown.push(file),
  },
};
const key = Symbol.for("colonia.test.updater");
Object.assign(globalThis, { [key]: native });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("colonia.test.updater")]; export const app = n.app; export const shell = n.shell;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createDesktopUpdater, pickUpdate } = await import("./updater.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalImage = process.env.APPIMAGE;
const originalFeed = process.env.COLONIA_RELEASES;
Object.defineProperty(process, "platform", { value: "linux" });
delete process.env.APPIMAGE;
process.env.COLONIA_RELEASES = "http://updates.test";
after(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  if (originalImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = originalImage;
  if (originalFeed === undefined) delete process.env.COLONIA_RELEASES;
  else process.env.COLONIA_RELEASES = originalFeed;
  fs.rmSync(directory, { recursive: true, force: true });
});
const name = `Colonia-2.1.0-linux-${process.arch}.AppImage`;
const asset = (filename: string) => ({ name: filename, browser_download_url: `http://updates.test/${filename}` });
const release = { tag_name: "v2.1.0", body: "- Better updates", assets: [asset(name), asset(`${name}.sha256`)] };
const bytes = "Test installer bytes";
const checksum = createHash("sha256").update(bytes).digest("hex");
function harness() {
  const states: DesktopUpdate[] = [];
  let quits = 0;
  const updater = createDesktopUpdater({ changed: (status) => states.push(status), quit: () => quits++ });
  return { updater, states, quits: () => quits };
}

test("update selection falls back to the newest compatible release and excludes unsupported targets", () => {
  const answer = pickUpdate([{ tag_name: "v2.2.0", assets: [] }, release], "2.0.0", "linux", process.arch);
  assert.equal(answer?.release.version, "2.1.0");
  assert.equal(answer?.asset.name, name);
  assert.deepEqual(answer?.notes, ["Better updates"]);
  assert.equal(pickUpdate([release], "2.1.0", "linux", process.arch), undefined);
  assert.equal(pickUpdate([release], "2.0.0", "freebsd", process.arch), undefined);
});

test("a release that says its notes per language passes them on in both; an older one in neither", () => {
  const body = "## Español\n\n- Mejores avisos\n\n## English\n\n- Better notices\n";
  const answer = pickUpdate([{ ...release, body }], "2.0.0", "linux", process.arch);
  assert.deepEqual(answer?.localized, { en: ["Better notices"], es: ["Mejores avisos"] });
  assert.deepEqual(answer?.notes, ["Better notices"], "what an app from before reads");
  assert.equal(pickUpdate([release], "2.0.0", "linux", process.arch)?.localized, undefined);
});

test("disabled updates stay offline and cannot claim an available installer", async (t) => {
  native.app.isPackaged = false;
  const h = harness();
  native.app.isPackaged = true;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected request");
  });
  assert.equal(h.updater.enabled, false);
  assert.equal((await h.updater.check()).latest, undefined);
  assert.deepEqual(await h.updater.install(), { ok: false, error: "No newer Colonia for this computer." });
  h.updater.start(() => assert.fail("Disabled updater started"));
  h.updater.stop();
  assert.deepEqual(h.updater.restart(), {
    ok: false,
    error: "The new version is no longer ready. Check for updates again.",
  });
  h.updater.quitting();
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(h.quits(), 0);
});

test("feed failures publish an error and a later successful check clears it", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const h = harness();
  const failed = await h.updater.check();
  assert.match(failed.error ?? "", /503/);
  assert.ok(failed.checked_at);
  fetch.mock.mockImplementation(async () => Response.json([release]));
  const recovered = await h.updater.check();
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.latest, "2.1.0");
  assert.equal(recovered.install, "drag");
  assert.deepEqual(recovered.notes, ["Better updates"]);
  assert.equal(h.states.length, 2);
});

test("concurrent installs share a verified download and only open the file after checksum validation", async (t) => {
  opened.length = 0;
  shown.length = 0;
  const requests: string[] = [];
  let finish: (() => void) | undefined;
  const download = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/releases?")) return Response.json([release]);
    if (url.endsWith(".sha256")) return new Response(`${checksum}  ${name}`);
    await download;
    return new Response(bytes);
  });
  const h = harness();
  await h.updater.check();
  const first = h.updater.install();
  const duplicate = h.updater.install();
  assert.equal(first, duplicate);
  assert.equal(h.updater.status().downloading, true);
  assert.deepEqual(opened, []);
  assert.ok(finish);
  finish();
  assert.deepEqual(await first, { ok: true, ready: false });
  assert.equal(h.updater.status().downloading, false);
  assert.equal(requests.filter((url) => url.endsWith(".AppImage")).length, 1);
  const file = path.join(directory, name);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  assert.equal(fs.existsSync(`${file}.sha256`), false);
  // On Linux the new file is shown, never run unasked.
  assert.deepEqual(opened, []);
  assert.deepEqual(shown, [file]);
  assert.equal(h.quits(), 0);
  fs.rmSync(file);
});

test("a corrupt download is deleted, never opened and installation can recover on retry", async (t) => {
  opened.length = 0;
  shown.length = 0;
  let valid = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([release]);
    if (url.endsWith(".sha256")) return new Response(valid ? checksum : "not a checksum");
    return new Response(bytes);
  });
  const h = harness();
  const failed = await h.updater.install();
  assert.equal(failed.ok, false);
  assert.match("error" in failed ? failed.error : "", /does not match/);
  assert.equal(fs.existsSync(path.join(directory, name)), false);
  assert.equal(h.updater.status().downloading, false);
  assert.deepEqual(opened, []);
  valid = true;
  assert.deepEqual(await h.updater.install(), { ok: true, ready: false });
  assert.deepEqual(opened, []);
  assert.deepEqual(shown, [path.join(directory, name)]);
});

test("a remote manual installer stays unopened until activation and uses the exact target", async (t) => {
  opened.length = 0;
  shown.length = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([{ ...release, tag_name: "v2.2.0", assets: [] }, release]);
    if (url.endsWith(".sha256")) return new Response(checksum);
    return new Response(bytes);
  });
  const h = harness();
  assert.deepEqual(await h.updater.install("2.1.0", true), { ok: true, ready: true });
  assert.equal(h.updater.status().ready, "2.1.0");
  assert.deepEqual(opened, []);
  h.updater.quitting();
  assert.deepEqual(opened, []);
  assert.deepEqual(h.updater.restart(), { ok: true });
  assert.deepEqual(opened, []);
  assert.deepEqual(shown, [path.join(directory, name)]);
});

test("an AppImage in a folder Colonia cannot write updates by hand", async (t) => {
  const image = path.join(directory, "locked", "Colonia.AppImage");
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(image, "old");
  process.env.APPIMAGE = image;
  t.after(() => {
    delete process.env.APPIMAGE;
  });
  shown.length = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([release]);
    if (url.endsWith(".sha256")) return new Response(checksum);
    return new Response(bytes);
  });
  const updater = createDesktopUpdater({ changed: () => {}, quit: () => {}, writable: () => false });
  assert.equal(updater.mode, "drag");
  assert.deepEqual(await updater.install(), { ok: true, ready: false });
  assert.deepEqual(fs.readdirSync(path.dirname(image)), ["Colonia.AppImage"], "nothing is written beside the image");
  assert.equal(fs.readFileSync(image, "utf8"), "old");
  assert.deepEqual(shown, [path.join(directory, name)]);
  fs.rmSync(path.join(directory, name));
});

test("AppImage download does not replace the running image until activation and quit is idempotent", async (t) => {
  const image = path.join(directory, "Colonia.AppImage");
  fs.writeFileSync(image, "Previous installer");
  process.env.APPIMAGE = image;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([release]);
    return new Response(url.endsWith(".sha256") ? checksum : bytes);
  });
  try {
    const h = harness();
    assert.equal((await h.updater.install("2.1.0", true)).ok, true);
    assert.equal(fs.readFileSync(image, "utf8"), "Previous installer");
    h.updater.discard();
    h.updater.quitting();
    assert.equal(fs.readFileSync(image, "utf8"), "Previous installer");
    assert.equal((await h.updater.install("2.1.0", true)).ok, true);
    h.updater.restart();
    assert.equal(fs.readFileSync(image, "utf8"), bytes);
    h.updater.quitting();
    assert.equal(relaunches, 1);
    assert.equal(h.quits(), 1);
  } finally {
    delete process.env.APPIMAGE;
  }
});

test("a release without its checksum cannot be staged", async (t) => {
  opened.length = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json([{ ...release, assets: [asset(name)] }]));
  const result = await harness().updater.install("2.1.0", true);
  assert.equal(result.ok, false);
  assert.match("error" in result ? result.error : "", /no .sha256/);
  assert.deepEqual(opened, []);
});

/** A staged Windows update with a fake installer launch; `started: false` is a spawn that failed (no pid). */
async function windowsUpdate(t: import("node:test").TestContext, started = true) {
  const dir = tempDir("colonia-updater-win-");
  const temp = dir.path;
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
  Object.defineProperty(process, "platform", { value: "win32" });
  t.after(async () => {
    await dir.remove();
    Object.defineProperty(process, "platform", { value: "linux" });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const exe = `Colonia-2.1.0-win-${process.arch}.exe`;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?"))
      return Response.json([{ ...release, assets: [asset(exe), asset(`${exe}.sha256`)] }]);
    return new Response(url.endsWith(".sha256") ? checksum : bytes);
  });
  const spawns: { file: string; args: string[] }[] = [];
  let quits = 0;
  const spawn = ((file: string, args: string[]) => {
    spawns.push({ file, args });
    return Object.assign(new EventEmitter(), { pid: started ? 4242 : undefined, unref() {} });
  }) as unknown as typeof import("node:child_process").spawn;
  const updater = createDesktopUpdater({ changed: () => {}, quit: () => quits++, spawn });
  assert.equal((await updater.install("2.1.0", true)).ok, true);
  return { updater, spawns, quits: () => quits, file: path.join(temp, exe) };
}

test("a Windows installer that does not start leaves Colonia open, and is not reused", async (t) => {
  const w = await windowsUpdate(t, false);
  const answer = w.updater.restart();
  assert.equal(answer.ok, false);
  assert.match("error" in answer ? answer.error : "", /installer did not start/);
  assert.equal(w.updater.status().ready, undefined);
  w.updater.quitting();
  assert.equal(w.spawns.length, 1, "nothing staged is left for the quit");
  assert.equal(w.quits(), 0);
});

test("a Windows installer deleted from the temporary folder is reported instead of quitting", async (t) => {
  const w = await windowsUpdate(t);
  fs.rmSync(w.file);
  const answer = w.updater.restart();
  assert.equal(answer.ok, false);
  assert.match("error" in answer ? answer.error : "", /no longer ready/);
  assert.deepEqual(w.spawns, []);
  w.updater.quitting();
  assert.deepEqual(w.spawns, []);
  assert.equal(w.quits(), 0);
});

test("Windows quits into the installer once it started, with --updated, and the quit does not start it again", async (t) => {
  const w = await windowsUpdate(t);
  assert.deepEqual(w.updater.restart(), { ok: true });
  assert.deepEqual(w.spawns, [{ file: w.file, args: ["--updated"] }]);
  await waitFor(() => w.quits() === 1, "the quit after the installer started");
  w.updater.quitting();
  assert.equal(w.spawns.length, 1);
});

test("quitting with a Windows update downloaded installs it silently, once", async (t) => {
  const w = await windowsUpdate(t);
  w.updater.quitting();
  w.updater.quitting();
  assert.deepEqual(w.spawns, [{ file: w.file, args: ["--updated", "/S"] }]);
  assert.equal(w.quits(), 0);
});

test("a Colonia installed from a package is offered that package, never the AppImage", () => {
  const names = [
    "Colonia-2.4.0-linux-x86_64.AppImage",
    "Colonia-2.4.0-linux-amd64.deb",
    "Colonia-2.4.0-linux-x86_64.rpm",
    "Colonia-2.4.0-linux-arm64.deb",
    "Colonia-2.4.0-linux-aarch64.rpm",
  ];
  const feed = [
    { tag_name: "v2.4.0", body: "", assets: names.map((n) => ({ name: n, browser_download_url: `https://x/${n}` })) },
  ];
  assert.equal(pickUpdate(feed, "2.3.0", "linux", "x64")?.asset.name, "Colonia-2.4.0-linux-x86_64.AppImage");
  assert.equal(pickUpdate(feed, "2.3.0", "linux", "x64", "deb")?.asset.name, "Colonia-2.4.0-linux-amd64.deb");
  assert.equal(pickUpdate(feed, "2.3.0", "linux", "x64", "rpm")?.asset.name, "Colonia-2.4.0-linux-x86_64.rpm");
  assert.equal(pickUpdate(feed, "2.3.0", "linux", "arm64", "deb")?.asset.name, "Colonia-2.4.0-linux-arm64.deb");
  assert.equal(pickUpdate(feed, "2.3.0", "linux", "arm64", "rpm")?.asset.name, "Colonia-2.4.0-linux-aarch64.rpm");
});
