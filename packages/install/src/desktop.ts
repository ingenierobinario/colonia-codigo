import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesktopInstallStatus } from "@colonia/protocol";
import { desktopAssetFor, fetchReleases, newerReleases, platformOf, RELEASE_FEED } from "@colonia/protocol";
import { type LinuxHost, linuxHost } from "./appimage.ts";
import { downloadDesktop } from "./download.ts";
import { openLinuxDesktop } from "./linux-launch.ts";
import { type PackageKind, packageCommand, packageInstallArgs, packageOwner } from "./linux-package.ts";
import { desktopCandidates, desktopDataDir, hasDesktop, type LocalTarget, saveLocalTarget } from "./paths.ts";
import { installDesktopFile } from "./platform.ts";
import { type ProcessRunner, runProcess } from "./process.ts";

export type DesktopInstallOptions = {
  platform: string;
  arch: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  feed: string;
  version?: string | undefined;
  target?: (() => LocalTarget | undefined) | undefined;
  run?: ProcessRunner;
  fetch?: typeof fetch;
  changed?: (status: DesktopInstallStatus) => void;
  /** The installed paths at a filesystem boundary; tests keep every platform inside a temporary home. */
  candidates?: readonly string[];
  session?: () => NodeJS.ProcessEnv;
  /** What is read from a Linux machine to explain an AppImage that will not start. */
  host?: LinuxHost;
  /** Which package database owns an installed Linux app, and its version; undefined for an AppImage or a loose copy. */
  linuxPackage?: (app: string) => Promise<{ kind: PackageKind; version: string } | undefined>;
  /** Whether this process may run the package manager itself (it runs as root). */
  privileged?: boolean;
  /** Something the person should know although the app opened. */
  note?: (text: string) => void;
};

export function createDesktopInstaller(opts: DesktopInstallOptions) {
  let state: DesktopInstallStatus = { available: false, installed: false, phase: "idle", received: 0 };
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  /** Set only by an explicit cancel, so closing the core still reports a failed download. */
  let stop: "none" | "cancel" = "none";
  let env = opts.env;
  let checkedSession = 0;
  const candidates = opts.candidates ?? desktopCandidates(opts.platform, opts.env, opts.userHome);
  const found = () => candidates.find((p) => fs.existsSync(p));
  const run = opts.run ?? runProcess;
  /** Where a package the owner installs by hand is left: their downloads, or the desktop's own folder. */
  const keepDir = () => {
    const downloads = path.join(opts.userHome, "Downloads");
    const dir = fs.existsSync(downloads) ? downloads : desktopDataDir(opts.platform, env, opts.userHome);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const available = () => {
    if (opts.feed === "off" && !found()) return false;
    if (!hasDesktop(opts.platform, env) && opts.session && Date.now() - checkedSession > 30_000) {
      checkedSession = Date.now();
      env = opts.session();
    }
    return hasDesktop(opts.platform, env) && Boolean(platformOf(opts.platform, opts.arch));
  };
  const status = (): DesktopInstallStatus => ({ ...state, available: available(), installed: Boolean(found()) });
  const change = (patch: Partial<DesktopInstallStatus>) => {
    state = { ...state, ...patch };
    opts.changed?.(status());
  };
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const fail = (error: unknown) => {
    if (stop === "cancel") {
      state = { available: state.available, installed: state.installed, phase: "idle", received: 0 };
      opts.changed?.(status());
      return;
    }
    change({ phase: "failed", error: message(error) });
  };

  async function install(signal: AbortSignal): Promise<void> {
    let work: string | undefined;
    try {
      const platform = platformOf(opts.platform, opts.arch);
      const fetchImpl: typeof fetch = (input, init) =>
        (opts.fetch ?? fetch)(input, {
          ...init,
          signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
        });
      /** The release wanted (or the newest) with a file of this kind, downloaded and checked into `dir`. */
      const fetchFile = async (kind: "installer" | "zip" | PackageKind, dir: () => string) => {
        if (!platform) throw new Error("No desktop app for this platform");
        const release = newerReleases(await fetchReleases(opts.feed || RELEASE_FEED, fetchImpl), "0.0.0")
          .filter((r) => !opts.version || r.version === opts.version)
          .find((r) => desktopAssetFor(r.assets, r.version, platform, kind));
        const asset = release && desktopAssetFor(release.assets, release.version, platform, kind);
        if (!release || !asset) throw new Error("No desktop download available for this system");
        const file = path.join(dir(), asset.name);
        // A package left in Downloads by an earlier try is fetched again and checked, not trusted.
        fs.rmSync(file, { force: true });
        await downloadDesktop({
          asset,
          assets: release.assets,
          file,
          signal,
          fetch: fetchImpl,
          progress: (received, total) => change({ received, ...(total ? { total } : {}) }),
        });
        signal.throwIfAborted();
        return { file, version: release.version };
      };
      const scratch = () => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-desktop-install-"));
        return work;
      };
      let app = found();
      // A Colonia the package manager owns is updated by the package manager, never by an AppImage beside it.
      const owned = app && opts.platform === "linux" ? await (opts.linuxPackage ?? packageOwner)(app) : undefined;
      if (app && owned && opts.version && owned.version !== opts.version) {
        const privileged = opts.privileged ?? process.getuid?.() === 0;
        const { file } = await fetchFile(owned.kind, () => (privileged ? scratch() : keepDir()));
        if (!privileged)
          throw new Error(
            `Colonia ${opts.version} is downloaded. Install it with your package manager: ${packageCommand(owned.kind, file)}`,
          );
        change({ phase: "installing" });
        const [command, args] = packageInstallArgs(owned.kind, file);
        await run(command, args, { signal, env: launchEnv(env) });
      }
      if (!app) {
        const file = (await fetchFile(platform?.os === "mac" ? "zip" : "installer", scratch)).file;
        change({ phase: "installing" });
        app = await installDesktopFile(
          { platform: opts.platform, userHome: opts.userHome, env: launchEnv(env), run, found },
          file,
          work ?? scratch(),
          signal,
        );
      }
      signal.throwIfAborted();
      const target = opts.target?.();
      if (target) saveLocalTarget(desktopDataDir(opts.platform, env, opts.userHome), target);
      change({ phase: "opening" });
      const args = target ? ["--colonia-adopt-local"] : [];
      if (opts.platform === "linux" && app.endsWith(".AppImage"))
        await openLinuxDesktop({
          app,
          args,
          userHome: opts.userHome,
          env: launchEnv(env),
          run,
          signal,
          dataDir: desktopDataDir(opts.platform, env, opts.userHome),
          host: opts.host ?? linuxHost,
          note: opts.note,
        });
      else
        await run(
          opts.platform === "darwin" ? "/usr/bin/open" : app,
          opts.platform === "darwin"
            ? [...(target ? ["-n"] : []), "-a", app, ...(target ? ["--args", "--colonia-adopt-local"] : [])]
            : args,
          { signal, detached: opts.platform !== "darwin", env: launchEnv(env) },
        );
      change({ phase: "ready" });
    } catch (error) {
      fail(error);
    } finally {
      if (work) fs.rmSync(work, { recursive: true, force: true });
    }
  }

  return {
    status,
    start(): DesktopInstallStatus {
      if (running) return status();
      if (!available()) throw new Error("Desktop installation needs a local graphical session");
      stop = "none";
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12 * 60_000)]);
      state = { available: true, installed: Boolean(found()), phase: "downloading", received: 0 };
      running = install(signal)
        .catch((error: unknown) => {
          change({ phase: "failed", error: message(error) });
        })
        .finally(() => {
          running = undefined;
        });
      return status();
    },
    /** Aborts a download still in progress and returns the notice to idle. Installing or opening is left alone. */
    async cancel(): Promise<DesktopInstallStatus> {
      if (!running || state.phase !== "downloading") return status();
      stop = "cancel";
      controller?.abort();
      await running;
      return status();
    },
    async wait(): Promise<DesktopInstallStatus> {
      await running;
      return status();
    },
    async close(): Promise<void> {
      controller?.abort();
      await running;
    },
  };
}

/** A service's runtime settings must not redirect the desktop or make Electron run as Node. */
function launchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        (!key.startsWith("COLONIA_") || key === "COLONIA_DESKTOP_DATA" || key === "COLONIA_RELEASES") &&
        key !== "ELECTRON_RUN_AS_NODE",
    ),
  );
}

export type DesktopInstaller = ReturnType<typeof createDesktopInstaller>;
