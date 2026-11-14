// INSTALAR-NAV-1: what each system is offered, how each browser gets installed, and how an install ends.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_CATALOG,
  browsersFor,
  findWinget,
  type InstallDeps,
  type InstallEnv,
  type InstallProgress,
  installBrowser,
  installPlan,
  missingBrowsers,
} from "./install.ts";

const ids = (list: Array<{ id: string }>) => list.map((b) => b.id);
const SIX = ["chrome", "edge", "firefox", "brave", "opera", "vivaldi"];
const win: InstallEnv = { platform: "win32", arch: "x64", winget: true };
const mac: InstallEnv = { platform: "darwin", arch: "arm64", winget: false };
const deb: InstallEnv = { platform: "linux", arch: "x64", winget: false, pkg: "deb" };

test("each system gets its list: the six everywhere, Safari only on macOS", () => {
  assert.deepEqual(ids(browsersFor("win32")), SIX);
  assert.deepEqual(ids(browsersFor("linux")), SIX);
  assert.deepEqual(ids(browsersFor("darwin")), [...SIX, "safari"]);
});

test("only what the computer lacks is offered, and Safari is never installed", () => {
  assert.deepEqual(ids(missingBrowsers("win32", ["chrome", "edge"])), ["firefox", "brave", "opera", "vivaldi"]);
  assert.deepEqual(ids(missingBrowsers("darwin", [])), SIX);
  assert.deepEqual(ids(missingBrowsers("linux", SIX)), []);
  assert.deepEqual(missingBrowsers("win32", SIX.slice(1)), [{ id: "chrome", name: "Google Chrome" }]);
});

test("Windows with winget: the exact command, with the maker's id from the closed list", () => {
  const expected: Record<string, string> = {
    chrome: "Google.Chrome",
    edge: "Microsoft.Edge",
    firefox: "Mozilla.Firefox",
    brave: "Brave.Brave",
    opera: "Opera.Opera",
    vivaldi: "Vivaldi.Vivaldi",
  };
  for (const [id, pkg] of Object.entries(expected)) {
    const plan = installPlan(id, win);
    assert.equal(plan?.kind, "winget");
    if (plan?.kind !== "winget") continue;
    assert.equal(plan.command, "winget");
    assert.deepEqual(plan.args.slice(0, 4), ["install", "-e", "--id", pkg]);
    assert.deepEqual(plan.args.slice(4), [
      "--source",
      "winget",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
  }
});

test("Windows without winget: the maker's installer, or its page when it has no fixed address", () => {
  const env = { ...win, winget: false };
  assert.deepEqual(installPlan("chrome", env), {
    name: "Google Chrome",
    page: "https://www.google.com/chrome/",
    kind: "download",
    url: "https://dl.google.com/chrome/install/latest/chrome_installer.exe",
    file: "ChromeSetup.exe",
  });
  const firefox = installPlan("firefox", { ...env, lang: "es-MX" });
  assert.equal(
    firefox?.kind === "download" && firefox.url,
    "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=es-ES",
  );
  const arm = installPlan("firefox", { ...env, arch: "arm64", lang: "en-GB" });
  assert.equal(
    arm?.kind === "download" && arm.url,
    "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64-aarch64&lang=en-US",
  );
  assert.equal(installPlan("brave", env)?.kind, "download");
  assert.equal(installPlan("brave", { ...env, arch: "arm64" })?.kind, "page");
  assert.equal(installPlan("opera", env)?.kind, "download");
  assert.deepEqual(installPlan("edge", env), {
    name: "Microsoft Edge",
    page: "https://www.microsoft.com/edge/download",
    kind: "page",
  });
  assert.equal(installPlan("vivaldi", env)?.kind, "page");
});

test("macOS: the maker's disk image; Linux: its package for that system, or its page", () => {
  for (const id of ["chrome", "edge", "firefox", "brave"]) {
    const plan = installPlan(id, mac);
    assert.equal(plan?.kind === "download" && plan.file.endsWith(".dmg"), true, id);
  }
  assert.equal(installPlan("opera", mac)?.kind, "page");
  assert.equal(installPlan("vivaldi", mac)?.kind, "page");
  // winget is never used off Windows, whatever the environment claims.
  assert.equal(installPlan("chrome", { ...mac, winget: true })?.kind, "download");

  const chromeDeb = installPlan("chrome", deb);
  assert.equal(
    chromeDeb?.kind === "download" && chromeDeb.url,
    "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
  );
  const chromeRpm = installPlan("chrome", { ...deb, pkg: "rpm" });
  assert.equal(
    chromeRpm?.kind === "download" && chromeRpm.url,
    "https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm",
  );
  assert.equal(installPlan("chrome", { ...deb, arch: "arm64" })?.kind, "page");
  assert.equal(installPlan("chrome", { platform: "linux", arch: "x64", winget: false })?.kind, "page");
  assert.equal(installPlan("firefox", deb)?.kind, "page");
});

test("nothing outside the closed list can be installed", () => {
  for (const bad of ["Google.Chrome", "chrome --override x", "https://example.com/a.exe", "", "__proto__", 7, null])
    assert.equal(installPlan(bad, win), undefined, String(bad));
  assert.equal(installPlan("safari", mac), undefined, "it comes with the system");
  assert.equal(installPlan("safari", win), undefined);
});

test("every address in the list is https and belongs to the browser's maker", () => {
  const makers: Record<string, RegExp> = {
    chrome: /^https:\/\/(dl|www)\.google\.com\//,
    edge: /^https:\/\/(go|www)\.microsoft\.com\//,
    firefox: /^https:\/\/(download|www)\.mozilla\.org\//,
    brave: /^https:\/\/(laptop-updates\.)?brave\.com\//,
    opera: /^https:\/\/(net\.geo|www)\.opera\.com\//,
    vivaldi: /^https:\/\/vivaldi\.com\//,
    safari: /^https:\/\/www\.apple\.com\//,
  };
  const envs: InstallEnv[] = [];
  for (const platform of ["win32", "darwin", "linux"] as const)
    for (const arch of ["x64", "arm64"])
      for (const pkg of [undefined, "deb", "rpm"] as const)
        envs.push({ platform, arch, winget: false, ...(pkg ? { pkg } : {}) });
  for (const b of BROWSER_CATALOG) {
    const maker = makers[b.id];
    assert.ok(maker, b.id);
    assert.match(b.page, maker);
    for (const env of envs) {
      const file = b.download?.(env);
      if (file) assert.match(file.url, maker, `${b.id} ${env.platform} ${env.arch}`);
    }
  }
});

/** An install with nothing real behind it: what was run, downloaded and opened, and what the panel was told. */
function fake(env: InstallEnv, over: Partial<InstallDeps> = {}) {
  const ran: string[][] = [];
  const downloaded: string[] = [];
  const opened: string[] = [];
  const said: InstallProgress[] = [];
  const state = { installed: false };
  const deps: InstallDeps = {
    env,
    exec: async (command, args) => {
      ran.push([command, ...args]);
      return 0;
    },
    download: async (url, file, onPercent) => {
      downloaded.push(url);
      onPercent(10.4);
      onPercent(10.9);
      onPercent(100);
      return `/tmp/${file}`;
    },
    open: async (file) => {
      opened.push(file);
    },
    detect: () => state.installed,
    progress: (p) => said.push(p),
    sleep: async () => {},
    waitMs: 0,
    pollMs: 0,
    ...over,
  };
  return { deps, ran, downloaded, opened, said, state };
}
const phases = (said: InstallProgress[]) => said.map((p) => (p.step ? `${p.phase}:${p.step}` : p.phase));
const go = (id: unknown, deps: InstallDeps, signal = new AbortController().signal) => installBrowser(id, deps, signal);

test("winget installs it: done only because the browser is then found", async () => {
  const f = fake(win);
  f.deps.exec = async (command, args) => {
    f.ran.push([command, ...args]);
    f.state.installed = true;
    return 0;
  };
  const end = await go("firefox", f.deps);
  assert.deepEqual(end, {
    id: "firefox",
    name: "Firefox",
    page: "https://www.mozilla.org/firefox/new/",
    phase: "done",
  });
  assert.deepEqual(f.ran[0]?.slice(0, 5), ["winget", "install", "-e", "--id", "Mozilla.Firefox"]);
  assert.deepEqual(phases(f.said), ["installing", "done"]);
  assert.deepEqual(f.downloaded, []);
});

test("winget fails or cannot start: the maker's installer is downloaded and opened instead", async () => {
  for (const exec of [async () => 1, async () => Promise.reject(new Error("ENOENT"))]) {
    const f = fake(win, { exec });
    f.deps.open = async (file) => {
      f.opened.push(file);
      f.state.installed = true;
    };
    const end = await go("chrome", f.deps);
    assert.equal(end.phase, "done");
    assert.deepEqual(f.downloaded, ["https://dl.google.com/chrome/install/latest/chrome_installer.exe"]);
    assert.deepEqual(f.opened, ["/tmp/ChromeSetup.exe"]);
    assert.deepEqual(phases(f.said), [
      "installing",
      "downloading",
      "downloading",
      "downloading",
      "waiting:installer",
      "done",
    ]);
    // Whole percentages, each said once.
    assert.deepEqual(
      f.said.filter((p) => p.phase === "downloading").map((p) => p.percent),
      [undefined, 10, 100],
    );
  }
});

test("macOS: the disk image is opened and the owner is told to drag it", async () => {
  const f = fake(mac);
  f.deps.open = async (file) => {
    f.opened.push(file);
    f.state.installed = true;
  };
  const end = await go("brave", f.deps);
  assert.equal(end.phase, "done");
  assert.deepEqual(f.ran, [], "nothing is run on macOS");
  assert.deepEqual(f.opened, ["/tmp/Brave-Browser.dmg"]);
  assert.ok(phases(f.said).includes("waiting:dmg"));
});

test("Linux: the package is opened; with no package for it, the maker's page", async () => {
  const f = fake(deb);
  await go("chrome", f.deps);
  assert.deepEqual(f.opened, ["/tmp/google-chrome-stable_current_amd64.deb"]);
  assert.ok(phases(f.said).includes("waiting:package"));

  const page = fake(deb);
  const end = await go("vivaldi", page.deps);
  assert.deepEqual(phases(page.said), ["waiting:page", "failed"]);
  assert.equal(end.page, "https://vivaldi.com/download/");
  assert.deepEqual([page.ran, page.downloaded, page.opened], [[], [], []]);
});

test("the browser never appears: it ends failed, with the maker's page to finish by hand", async () => {
  const f = fake({ ...win, winget: false });
  const end = await go("chrome", f.deps);
  assert.equal(end.phase, "failed");
  assert.equal(end.page, "https://www.google.com/chrome/");
  assert.equal(f.said.at(-1)?.phase, "failed");
});

test("the download breaks: the maker's page is what is left, and it still ends done if the owner installs it", async () => {
  let looks = 0;
  const f = fake(mac, {
    download: async () => Promise.reject(new Error("offline")),
    detect: () => ++looks > 2,
    waitMs: 60_000,
  });
  const end = await go("firefox", f.deps);
  assert.equal(end.phase, "done");
  assert.deepEqual(phases(f.said), ["downloading", "waiting:page", "done"]);
  assert.deepEqual(f.opened, []);
});

test("cancelled: it stops waiting and never says done", async () => {
  const stop = new AbortController();
  const f = fake(mac, { waitMs: 60_000 });
  f.deps.sleep = async () => stop.abort();
  const end = await go("opera", f.deps, stop.signal);
  assert.equal(end.phase, "failed");

  const during = new AbortController();
  const g = fake(win);
  g.deps.exec = async () => {
    during.abort();
    return 1;
  };
  assert.equal((await go("chrome", g.deps, during.signal)).phase, "failed");
  assert.deepEqual(g.downloaded, [], "nothing else is tried after a cancel");
});

test("an id outside the list runs nothing", async () => {
  for (const bad of ["Evil.Package", "safari", 7, undefined]) {
    const f = fake(win);
    const end = await go(bad, f.deps);
    assert.equal(end.phase, "failed");
    assert.deepEqual([f.ran, f.downloaded, f.opened, f.said], [[], [], [], []]);
  }
});

test("winget is looked for only on Windows", () => {
  assert.equal(findWinget({ LOCALAPPDATA: "C:\\nope", PATH: "C:\\nope" }, "win32"), false);
  assert.equal(findWinget({ PATH: "/usr/bin" }, "linux"), false);
  assert.equal(findWinget({}, "darwin"), false);
});
