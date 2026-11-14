// INSTALAR-NAV-1: installs a browser this computer does not have, from its maker and nowhere else. Everything a
// request can reach is in the closed list below: the panel names a browser by id, never an address or a command.
// Windows uses winget when it is there; otherwise (and on macOS and Linux) the maker's own installer is downloaded
// and opened, or its download page is shown. Then the computer is looked at again until the browser appears.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstallSystem = "win32" | "darwin" | "linux";
export type InstallEnv = {
  platform: NodeJS.Platform;
  arch: string;
  /** winget answers on this computer (Windows only). */
  winget: boolean;
  /** The package format this Linux installs. */
  pkg?: "deb" | "rpm";
  /** The app's language ("es", "en-GB"…): Firefox's installer comes in it. */
  lang?: string;
};

type Entry = {
  id: string;
  name: string;
  /** The maker's download page: the fallback, and the link shown when something fails. */
  page: string;
  systems: InstallSystem[];
  /** Comes with the system: never offered to install. */
  builtIn?: boolean;
  winget?: string;
  /** The maker's installer for a system, when it has one address that always serves the current version. */
  download?: (env: InstallEnv) => { url: string; file: string } | undefined;
};

const ALL: InstallSystem[] = ["win32", "darwin", "linux"];
const x64 = (env: InstallEnv) => env.arch === "x64";

export const BROWSER_CATALOG: readonly Entry[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    page: "https://www.google.com/chrome/",
    systems: ALL,
    winget: "Google.Chrome",
    download: (env) => {
      if (env.platform === "win32")
        return { url: "https://dl.google.com/chrome/install/latest/chrome_installer.exe", file: "ChromeSetup.exe" };
      if (env.platform === "darwin")
        return {
          url: "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg",
          file: "googlechrome.dmg",
        };
      if (!x64(env)) return undefined;
      if (env.pkg === "deb")
        return {
          url: "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
          file: "google-chrome-stable_current_amd64.deb",
        };
      if (env.pkg === "rpm")
        return {
          url: "https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm",
          file: "google-chrome-stable_current_x86_64.rpm",
        };
      return undefined;
    },
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    page: "https://www.microsoft.com/edge/download",
    systems: ALL,
    winget: "Microsoft.Edge",
    download: (env) =>
      env.platform === "darwin"
        ? { url: "https://go.microsoft.com/fwlink/?linkid=2192091", file: "MicrosoftEdge.dmg" }
        : undefined,
  },
  {
    id: "firefox",
    name: "Firefox",
    page: "https://www.mozilla.org/firefox/new/",
    systems: ALL,
    winget: "Mozilla.Firefox",
    download: (env) => {
      const lang = env.lang?.toLowerCase().startsWith("es") ? "es-ES" : "en-US";
      const from = (system: string) =>
        `https://download.mozilla.org/?product=firefox-latest-ssl&os=${system}&lang=${lang}`;
      if (env.platform === "win32")
        return { url: from(env.arch === "arm64" ? "win64-aarch64" : "win64"), file: "FirefoxSetup.exe" };
      if (env.platform === "darwin") return { url: from("osx"), file: "Firefox.dmg" };
      return undefined;
    },
  },
  {
    id: "brave",
    name: "Brave",
    page: "https://brave.com/download/",
    systems: ALL,
    winget: "Brave.Brave",
    download: (env) => {
      if (env.platform === "win32" && x64(env))
        return { url: "https://laptop-updates.brave.com/latest/winx64", file: "BraveBrowserSetup.exe" };
      if (env.platform === "darwin")
        return { url: "https://laptop-updates.brave.com/latest/osx", file: "Brave-Browser.dmg" };
      return undefined;
    },
  },
  {
    id: "opera",
    name: "Opera",
    page: "https://www.opera.com/download",
    systems: ALL,
    winget: "Opera.Opera",
    download: (env) =>
      env.platform === "win32" && x64(env)
        ? { url: "https://net.geo.opera.com/opera/stable/windows", file: "OperaSetup.exe" }
        : undefined,
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    page: "https://vivaldi.com/download/",
    systems: ALL,
    winget: "Vivaldi.Vivaldi",
  },
  { id: "safari", name: "Safari", page: "https://www.apple.com/safari/", systems: ["darwin"], builtIn: true },
];

const entry = (id: unknown): Entry | undefined => BROWSER_CATALOG.find((b) => b.id === id);

/** The browsers Colonia knows for a system, in the order they are shown. */
export function browsersFor(platform: NodeJS.Platform): Array<{ id: string; name: string }> {
  return BROWSER_CATALOG.filter((b) => b.systems.includes(platform as InstallSystem)).map(({ id, name }) => ({
    id,
    name,
  }));
}

/** The ones this computer lacks and can get: what "+" offers to install. */
export function missingBrowsers(platform: NodeJS.Platform, installed: string[]): Array<{ id: string; name: string }> {
  const have = new Set(installed);
  return BROWSER_CATALOG.filter(
    (b) => b.systems.includes(platform as InstallSystem) && !b.builtIn && !have.has(b.id),
  ).map(({ id, name }) => ({ id, name }));
}

export type InstallPlan = { name: string; page: string } & (
  | { kind: "winget"; command: "winget"; args: string[] }
  | { kind: "download"; url: string; file: string }
  | { kind: "page" }
);

/** How one browser gets installed here. Undefined: not in the list, not for this system, or it comes with it. */
export function installPlan(id: unknown, env: InstallEnv): InstallPlan | undefined {
  const b = entry(id);
  if (!b || b.builtIn || !b.systems.includes(env.platform as InstallSystem)) return undefined;
  const base = { name: b.name, page: b.page };
  if (env.platform === "win32" && env.winget && b.winget)
    return {
      ...base,
      kind: "winget",
      command: "winget",
      args: [
        "install",
        "-e",
        "--id",
        b.winget,
        "--source",
        "winget",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
      ],
    };
  const file = b.download?.(env);
  return file ? { ...base, kind: "download", ...file } : { ...base, kind: "page" };
}

export type InstallProgress = {
  id: string;
  name: string;
  /** The maker's page, for the link shown beside a failure. */
  page: string;
  phase: "installing" | "downloading" | "waiting" | "done" | "failed";
  /** 0–100 while downloading, when the size is known. */
  percent?: number;
  /** What the owner has in front while waiting: an installer, a disk image, a package, or the maker's page. */
  step?: "installer" | "dmg" | "package" | "page";
};

export type InstallDeps = {
  env: InstallEnv;
  /** Runs a program to its end; resolves its exit code (rejects when it cannot start). */
  exec: (command: string, args: string[], signal: AbortSignal) => Promise<number>;
  /** Saves an address to a file; resolves its path. */
  download: (url: string, file: string, onPercent: (percent: number) => void, signal: AbortSignal) => Promise<string>;
  /** Opens a downloaded installer, disk image or package with the system. */
  open: (file: string) => Promise<void>;
  /** Looks at the computer again: is this browser there now? */
  detect: (id: string) => boolean;
  progress: (p: InstallProgress) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How long the owner gets to finish an installer or a page before it counts as not done. */
  waitMs?: number;
  pollMs?: number;
};

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const stepOf = (file: string): NonNullable<InstallProgress["step"]> =>
  file.endsWith(".dmg") ? "dmg" : /\.(deb|rpm)$/.test(file) ? "package" : "installer";

/**
 * Installs one browser and says how it went. It ends "done" only when the browser is really found afterwards;
 * anything else ends "failed", with the maker's page for the owner to finish by hand.
 */
export async function installBrowser(id: unknown, deps: InstallDeps, signal: AbortSignal): Promise<InstallProgress> {
  const first = installPlan(id, deps.env);
  if (!first || typeof id !== "string") {
    const b = entry(id);
    return { id: String(id), name: b?.name ?? "", page: b?.page ?? "", phase: "failed" };
  }
  const base = { id, name: first.name, page: first.page };
  const say = (p: Omit<InstallProgress, "id" | "name" | "page">): InstallProgress => {
    const full = { ...base, ...p };
    deps.progress(full);
    return full;
  };
  const sleep = deps.sleep ?? sleepFor;
  const found = async (step: NonNullable<InstallProgress["step"]>): Promise<boolean> => {
    say({ phase: "waiting", step });
    const until = Date.now() + (deps.waitMs ?? 10 * 60_000);
    while (!signal.aborted) {
      if (deps.detect(id)) return true;
      if (Date.now() >= until) return false;
      await sleep(deps.pollMs ?? 3000, signal);
    }
    return false;
  };

  let plan: InstallPlan = first;
  if (plan.kind === "winget") {
    say({ phase: "installing" });
    try {
      await deps.exec(plan.command, plan.args, signal);
    } catch {
      // winget could not start: the maker's installer is tried next.
    }
    if (deps.detect(id)) return say({ phase: "done" });
    if (signal.aborted) return say({ phase: "failed" });
    // winget refused (no network to its source, a policy, an error of its own): the maker's installer instead.
    plan = installPlan(id, { ...deps.env, winget: false }) ?? plan;
    if (plan.kind === "winget") return say({ phase: "failed" });
  }
  if (plan.kind === "download") {
    try {
      say({ phase: "downloading" });
      let last = -1;
      const file = await deps.download(
        plan.url,
        plan.file,
        (percent) => {
          const whole = Math.max(0, Math.min(100, Math.floor(percent)));
          if (whole === last) return;
          last = whole;
          say({ phase: "downloading", percent: whole });
        },
        signal,
      );
      if (signal.aborted) return say({ phase: "failed" });
      await deps.open(file);
      return say({ phase: (await found(stepOf(plan.file))) ? "done" : "failed" });
    } catch {
      if (signal.aborted) return say({ phase: "failed" });
      // The download or its opening failed: the maker's page is what is left.
    }
  }
  return say({ phase: (await found("page")) ? "done" : "failed" });
}

/** winget ships with current Windows as an app alias in the user's WindowsApps folder. */
export function findWinget(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  const dirs = [
    env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps") : "",
    ...(env.PATH ?? env.Path ?? "").split(";"),
  ].filter(Boolean);
  return dirs.some((d) => fs.existsSync(path.win32.join(d, "winget.exe")));
}

export function realInstallEnv(lang?: string): InstallEnv {
  const linux = process.platform === "linux";
  const has = (bin: string) => ["/usr/bin", "/bin", "/usr/sbin"].some((d) => fs.existsSync(path.join(d, bin)));
  return {
    platform: process.platform,
    arch: process.arch,
    winget: findWinget(),
    ...(linux && has("dpkg") ? { pkg: "deb" as const } : linux && has("rpm") ? { pkg: "rpm" as const } : {}),
    ...(lang ? { lang } : {}),
  };
}

export const execToEnd: InstallDeps["exec"] = (command, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, signal, timeout: 20 * 60_000 }, (error) => {
      if (!error) return resolve(0);
      if (typeof error.code === "number") return resolve(error.code);
      reject(error);
    });
  });

/** Saves the maker's installer to a folder of its own in the temporary directory. Only https, start to end. */
export const downloadToTemp: InstallDeps["download"] = async (url, file, onPercent, signal) => {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok || !res.body || !res.url.startsWith("https://")) throw new Error(`download failed (${res.status})`);
  const dir = path.join(os.tmpdir(), "colonia-navegadores");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(file));
  const total = Number(res.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(target);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.byteLength;
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (total) onPercent((got / total) * 100);
    }
  } catch (e) {
    out.destroy();
    fs.rmSync(target, { force: true });
    throw e;
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  return target;
};
