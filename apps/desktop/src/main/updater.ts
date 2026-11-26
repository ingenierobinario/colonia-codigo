// The installed app updates itself (it carries its own core): every few hours it asks the release feed whether a newer
// Colonia is out, downloads this platform's build, checks its .sha256 and leaves it ready; it goes in when the owner
// restarts Colonia, or when they quit it. macOS replaces its own Colonia.app from the release's zip; the AppImage replaces its
// file; Windows runs the installer. Where the app cannot replace itself (a read-only place, an unpacked Linux zip),
// the owner gets the installer to put in by hand; a Colonia installed from the .deb or .rpm gets the newer package and
// the one command that installs it. See DECISIONS.md#d-058.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  compareVersions,
  desktopAssetFor,
  fetchReleases,
  type LocalizedNotes,
  localizedChanges,
  newerReleases,
  platformOf,
  RELEASE_CHECK_EVERY_MS,
  RELEASE_FEED,
  type Release,
  type ReleaseAsset,
  releaseChanges,
} from "@colonia/protocol";
import { app, shell } from "electron";
import { bundlePlace, replaceableBundle, saveInFirst } from "./app-bundle.ts";
import { fetchChecked } from "./checked-download.ts";
import { removeOldInstallers } from "./installer-files.ts";
import { type LinuxInstall, linuxInstall, packageCommand } from "./linux-install.ts";
import { updateLog } from "./update-log.ts";
import { SWAP_MAC } from "./update-swap-mac.ts";

export type DesktopUpdate = {
  current: string;
  /** A newer Colonia with a build for this computer. */
  latest?: string | undefined;
  notes: string[];
  /** The same lines once per language, when the releases say them so. */
  localized?: LocalizedNotes | undefined;
  /** How it goes in: by itself at the next restart (auto), or the owner drags it in (macOS disk image). */
  install: "auto" | "drag" | "none";
  /** Downloading the newer Colonia now. */
  downloading?: boolean | undefined;
  /** The newer Colonia, downloaded and checked: it goes in when Colonia restarts. */
  ready?: string | undefined;
  /** UPDATE-PAQUETE-1 · Installed from a .deb or .rpm: the command that puts the downloaded package in. */
  command?: string | undefined;
  checked_at?: string | undefined;
  error?: string | undefined;
};
export type InstallAnswer = { ok: true; ready: boolean } | { ok: false; error: string };
/** ok: the app is quitting into the newer Colonia. */
export type RestartAnswer = { ok: true } | { ok: false; error: string };

const FIRST_MS = 60_000;
const run = promisify(execFile);

/**
 * The newest release that has an installer for this platform, and what it and the others since `current` change (a
 * release whose notes are only a changelog link still shows the ones before it).
 */
export function pickUpdate(
  list: unknown,
  current: string,
  platform: string,
  arch: string,
  /** A Linux Colonia installed from the system's package: its update is that package, not the AppImage. */
  pkg?: "deb" | "rpm",
): { release: Release; asset: ReleaseAsset; notes: string[]; localized?: LocalizedNotes | undefined } | undefined {
  const p = platformOf(platform, arch);
  if (!p) return undefined;
  const newer = newerReleases(list, current);
  for (const [i, release] of newer.entries()) {
    const asset = desktopAssetFor(release.assets, release.version, p, pkg ?? "installer");
    if (asset)
      return { release, asset, notes: releaseChanges(newer.slice(i)), localized: localizedChanges(newer.slice(i)) };
  }
  return undefined;
}

const writable = (dir: string) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// ARRANQUE-RAPIDO-1 · Windows: la versión nueva se descomprime junto a la instalada MIENTRAS Colonia sigue abierta;
// al reiniciar sólo se cambian dos carpetas de nombre (segundos). Antes el instalador NSIS borraba 6.400 ficheros,
// descomprimía 600 MB y los copiaba con Colonia cerrada: 7-8 minutos sin app (21-nov-2026, 2.36.60).
// SWAP-SIEMPRE-ABRE-1 · Los dos movimientos y la vuelta atrás se reintentan (un antivirus abre los .exe recién
// descomprimidos); si al final no hay Colonia.exe en su carpeta pero sí la copia anterior, se restaura. Un RunOnce
// (recover.ps1) cubre un corte de luz entre los dos movimientos. Lo que no entró deja `failed`: la descarga se queda y
// la próxima vez va el instalador de siempre, en vez de volver a bajar 600 MB en bucle.
const SWAP_WIN = `
param([int]$pid0, [string]$old, [string]$new, [string]$stage, [int]$relaunch, [string]$log, [string]$version, [int]$secs = 30, [int]$grace = 10)
# SWAP-RAPIDO-1 · CAUSA RAÍZ del 24-nov-2026 (2.36.70): el acceso directo abre Colonia con «Iniciar en» = la carpeta de
# la instalación y este script la heredaba como carpeta de trabajo: el propio cambio impedía renombrarla, reintentaba
# 30 s, se rendía y entraba el instalador (3 min). Se sale de ella antes de nada (Colonia también lo lanza ya desde fuera).
try { [System.IO.Directory]::SetCurrentDirectory((Split-Path -Parent $old)); Set-Location -LiteralPath (Split-Path -Parent $old) } catch {}
function Say($m) { if ($log) { try { Add-Content -LiteralPath $log -Value ("{0} swap: {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $m) } catch {} } }
function Has($dir) { return (Test-Path -LiteralPath (Join-Path $dir "Colonia.exe")) }
function Move-Retry($from, $to, $secs) {
  $until = (Get-Date).AddSeconds($secs)
  while ($true) {
    # A plain rename: Move-Item, when it fails, can leave $to created and the next try moves INTO it.
    try {
      if ((Test-Path -LiteralPath $to) -and -not (Get-ChildItem -LiteralPath $to -Force)) { Remove-Item -LiteralPath $to -Force }
      [System.IO.Directory]::Move($from, $to); return $true
    } catch {}
    if ((Get-Date) -ge $until) { return $false }
    Start-Sleep -Milliseconds 300
  }
}
$runOnce = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"
$recover = Join-Path $stage "recover.ps1"
if (Test-Path -LiteralPath $recover) {
  try { New-ItemProperty -Path $runOnce -Name "ColoniaUpdateRecover" -PropertyType String -Force -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $recover + '"') | Out-Null } catch {}
}
# SWAP-RAPIDO-1 · Los programas que Colonia arrancó (el núcleo y lo que él arranca: canales, MCP, codex, la barra de
# avisos…) heredan su carpeta de trabajo DENTRO de la instalación, y un proceso con la carpeta de trabajo dentro impide
# renombrarla. Su .exe no está en la instalación (powershell, node, codex), así que la espera por ExecutablePath no los
# veía: el cambio se rendía a los 30 s y entraba el instalador (24-nov-2026, 2.36.70). Se apunta el árbol de Colonia
# por PID (y su hora de creación, contra PIDs reutilizados) y lo que siga vivo tras $grace s se termina por PID.
function Get-Tree($roots, $born) {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $byId = @{}; foreach ($x in $all) { $byId[[int]$x.ProcessId] = $x }
  # This script and the wscript that started it are Colonia's children too: they are not ended.
  $skip = @{}; $p = [int]$PID
  while ($p -and $p -ne $pid0 -and -not $skip.ContainsKey($p) -and $byId.ContainsKey($p)) { $skip[$p] = 1; $p = [int]$byId[$p].ParentProcessId }
  $set = @{}; foreach ($r in $roots) { $set[[int]$r] = $null }
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($x in $all) {
      $id = [int]$x.ProcessId
      if ($set.ContainsKey($id) -or $skip.ContainsKey($id) -or -not $set.ContainsKey([int]$x.ParentProcessId)) { continue }
      if (-not $x.CreationDate -or $x.CreationDate -lt $born) { continue }
      $set[$id] = $x.CreationDate; $grew = $true
    }
  }
  $set.Remove([int]$pid0)
  return $set
}
function Get-Alive($known) {
  $now = @{}; foreach ($x in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) { $now[[int]$x.ProcessId] = $x.CreationDate }
  return @($known.Keys | Where-Object { $now.ContainsKey($_) -and $now[$_] -eq $known[$_] })
}
$known = @{}
$born = $null
try { $born = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid0" -ErrorAction SilentlyContinue).CreationDate } catch {}
if ($born) { $known = Get-Tree @($pid0) $born }
Say ("waiting for Colonia ({0}) and {1} programs it started" -f $pid0, $known.Count)
try { Wait-Process -Id $pid0 -Timeout 60 -ErrorAction SilentlyContinue } catch {}
if ($born) {
  # Orphans keep their parent's PID: what they started while Colonia closed is found the same way.
  $more = Get-Tree (@($pid0) + @($known.Keys)) $born
  foreach ($k in $more.Keys) { if (-not $known.ContainsKey($k)) { $known[$k] = $more[$k] } }
  $until = (Get-Date).AddSeconds($grace)
  while (((Get-Alive $known).Count -gt 0) -and ((Get-Date) -lt $until)) { Start-Sleep -Milliseconds 200 }
  $left = Get-Alive $known
  if ($left.Count -gt 0) {
    Say ("{0} programs Colonia started still ran after {1} s: ended by PID ({2})" -f $left.Count, $grace, ($left -join ", "))
    foreach ($id in $left) { try { & taskkill.exe /T /F /PID $id 2>&1 | Out-Null } catch {} }
    $until = (Get-Date).AddSeconds(10)
    while (((Get-Alive $known).Count -gt 0) -and ((Get-Date) -lt $until)) { Start-Sleep -Milliseconds 200 }
  }
}
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  $left = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($old + "\\", [StringComparison]::OrdinalIgnoreCase) })
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 200
}
$prev = Join-Path $stage "previous"
$applied = $false
$why = ""
if (Move-Retry $old $prev $secs) {
  if (Move-Retry $new $old $secs) {
    $applied = $true
    Say "new app in place ($version)"
    try {
      Get-ChildItem "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" -ErrorAction SilentlyContinue | ForEach-Object {
        if ((Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq "Colonia") { Set-ItemProperty $_.PSPath -Name DisplayVersion -Value $version }
      }
    } catch {}
  } else {
    $why = "could not move the new app in"
    if ((Move-Retry $prev $old $secs) -and (Has $old)) { Say "$why, the old one is back" } else { Say "$why, and the old one did not go back yet" }
  }
} else { $why = "a file of the old app stayed open"; Say "$why, it stays as it was" }
# The last net: Colonia must be in its folder whatever happened above.
if (-not (Has $old) -and (Has $prev)) {
  if (Test-Path -LiteralPath $old) { Move-Retry $old (Join-Path $stage ("broken-" + (Get-Date).Ticks)) 10 | Out-Null }
  if (Move-Retry $prev $old (2 * $secs)) { Say "the old app is back in its folder" } else { Say "the old app stays in $prev" }
}
if (Has $old) { try { Remove-ItemProperty -Path $runOnce -Name "ColoniaUpdateRecover" -ErrorAction SilentlyContinue } catch {} }
if (-not $applied) {
  try { Set-Content -LiteralPath (Join-Path $stage "failed") -Value $why } catch {}
  Say "$version did not go in: the download stays and the installer goes next time"
}
if ($relaunch -eq 1) {
  if (Has $old) { Start-Process -FilePath (Join-Path $old "Colonia.exe") }
  elseif (Has $prev) { Start-Process -FilePath (Join-Path $prev "Colonia.exe") }
}
if ($applied) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
`;

// ACTUALIZA-REABRE-1 · powershell.exe lanzado con `detached` (DETACHED_PROCESS, sin consola) sale con código 0 SIN
// ejecutar el script: el cambio de carpetas no corría nunca, no dejaba ni una línea en update.log, Colonia no se
// reabría y la versión volvía a bajarse (23-nov-2026, 2.36.67). wscript.exe no necesita consola: lanza PowerShell
// oculto y sobrevive al cierre de Colonia.
const LAUNCH_VBS = `Dim a, i: a = ""
For i = 1 To WScript.Arguments.Count - 1: a = a & " """ & WScript.Arguments(i) & """": Next
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """" & a, 0, False
`;

/** SWAP-SIEMPRE-ABRE-1 · Corre en el siguiente inicio de sesión si el cambio se cortó: vuelve a poner Colonia en su carpeta. */
function recoverScript(old: string, prev: string, next: string, stage: string, log: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return `
$old = ${q(old)}; $prev = ${q(prev)}; $new = ${q(next)}; $stage = ${q(stage)}; $log = ${q(log)}
function Say($m) { if ($log) { try { Add-Content -LiteralPath $log -Value ("{0} recover: {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $m) } catch {} } }
if (Test-Path -LiteralPath (Join-Path $old "Colonia.exe")) { exit 0 }
foreach ($src in @($prev, $new)) {
  if (Test-Path -LiteralPath (Join-Path $src "Colonia.exe")) {
    if (Test-Path -LiteralPath $old) { try { [System.IO.Directory]::Move($old, (Join-Path $stage ("broken-" + (Get-Date).Ticks))) } catch {} }
    try {
      [System.IO.Directory]::Move($src, $old)
      Say "Colonia was not in its folder after an interrupted update: put back from $src"
      try { Set-Content -LiteralPath (Join-Path $stage "failed") -Value "interrupted" } catch {}
      break
    } catch { Say "could not put Colonia back from $src" }
  }
}
`;
}

type Staged = { version: string; restart(): void; onQuit?(): void };

export function createDesktopUpdater(opts: {
  quit(): void;
  changed(status: DesktopUpdate): void;
  logFile?: string;
  /** Starts the Windows installer (a test passes its own, so no real installer runs). */
  spawn?: typeof spawn;
  writable?: (dir: string) => boolean;
  /** How this Linux Colonia was installed (a test passes its own). */
  linuxInstall?: () => Promise<LinuxInstall>;
  /** The running Colonia.exe (a test passes its own folder). */
  execPath?: string;
  /** Unpacks a zip into a folder (a test passes its own). */
  unzip?: (zip: string, into: string) => Promise<void>;
}) {
  const start = opts.spawn ?? spawn;
  const canWrite = opts.writable ?? writable;
  const env = process.env.COLONIA_RELEASES;
  const feed = env === "off" ? undefined : env || RELEASE_FEED;
  const enabled = app.isPackaged && Boolean(feed) && Boolean(platformOf(process.platform, process.arch));
  const bundle = process.platform === "darwin" ? replaceableBundle(process.execPath, canWrite) : undefined;
  // Why a Mac app cannot replace itself, so the owner is told what to do about it.
  const place = process.platform === "darwin" ? bundlePlace(process.execPath, canWrite) : undefined;
  // An AppImage replaces itself; run from an unpacked zip, the owner gets the file instead.
  const image = process.platform === "linux" ? process.env.APPIMAGE : undefined;
  // An AppImage in a folder Colonia cannot write (a system path, a read-only mount) cannot replace itself.
  const appImage = image && canWrite(path.dirname(image)) ? image : undefined;
  // Asked once, in the background (dpkg/rpm answer in milliseconds, but never on the main thread's clock).
  const installKind: Promise<"deb" | "rpm" | undefined> =
    process.platform === "linux" && !image
      ? (opts.linuxInstall ?? linuxInstall)()
          .then((k) => (k === "deb" || k === "rpm" ? k : undefined))
          .catch(() => undefined)
      : Promise.resolve(undefined);
  let pkg: "deb" | "rpm" | undefined;
  void installKind.then((k) => {
    pkg = k;
  });
  /** The command that installs the downloaded package, once it is downloaded. */
  let pkgCommand: string | undefined;
  const mode: DesktopUpdate["install"] = process.platform === "win32" || bundle || appImage ? "auto" : "drag";
  let found: ReturnType<typeof pickUpdate>;
  let status: DesktopUpdate = { current: app.getVersion(), notes: [], install: "none" };
  let staged: Staged | undefined;
  let downloading: Promise<InstallAnswer> | undefined;
  let swapping = false;
  /** SWAP-SIEMPRE-ABRE-1 · Versions whose unpacked folder did not go in: the installer goes instead. */
  const folderFailed = new Set<string>();
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let cleanup: Promise<void> = Promise.resolve();
  const log = opts.logFile ? updateLog(opts.logFile) : () => {};

  const current = (): DesktopUpdate => ({
    ...status,
    downloading: Boolean(downloading),
    ready: staged?.version,
    ...(pkgCommand ? { command: pkgCommand } : {}),
  });
  const publish = () => opts.changed(current());

  async function check(): Promise<DesktopUpdate> {
    if (!enabled || !feed) return current();
    try {
      const kind = await installKind;
      found = pickUpdate(await fetchReleases(feed), app.getVersion(), process.platform, process.arch, kind);
      status = {
        current: app.getVersion(),
        latest: found?.release.version,
        notes: found?.notes ?? [],
        localized: found?.localized,
        install: found ? mode : "none",
        checked_at: new Date().toISOString(),
      };
      // BUSCA-CADA-HORA-1: cada comprobación deja su línea; sin ella, update.log no distinguía «no buscó» de «al día».
      log(found ? `check: ${found.release.version} is out` : "check: up to date");
    } catch (err) {
      status = {
        ...status,
        error: err instanceof Error ? err.message : String(err),
        checked_at: new Date().toISOString(),
      };
      log(`check failed: ${status.error}`);
    }
    publish();
    return current();
  }

  /** Downloads the newer Colonia and leaves it ready (or, where it cannot go in by itself, opens it for the owner). */
  function install(target?: string, deferOpen = false): Promise<InstallAnswer> {
    if (!enabled) return Promise.resolve({ ok: false, error: "No newer Colonia for this computer." });
    if (staged && staged.version === (target ?? staged.version)) return Promise.resolve({ ok: true, ready: true });
    staged = undefined;
    const started = generation;
    log(`download: ${target ?? found?.release.version ?? "latest"}`);
    downloading ??= prepare(target, deferOpen)
      .then((answer) => {
        if (started !== generation) {
          staged = undefined;
          log("download dropped: the connection changed");
          return { ok: false as const, error: "The Colonia connection changed. Retry the update." };
        }
        log(
          answer.ok
            ? `download ${answer.ready ? "ready" : "opened"}: ${staged?.version ?? ""}`
            : `download failed: ${answer.error}`,
        );
        return answer;
      })
      .finally(() => {
        downloading = undefined;
        publish();
      });
    publish();
    return downloading;
  }

  async function prepare(target?: string, deferOpen = false): Promise<InstallAnswer> {
    await cleanup;
    if (target && feed) {
      const release = newerReleases(await fetchReleases(feed), "0.0.0").find((r) => r.version === target);
      const platform = platformOf(process.platform, process.arch);
      const asset =
        release && platform
          ? desktopAssetFor(release.assets, target, platform, (await installKind) ?? "installer")
          : undefined;
      if (!release || !asset) return { ok: false, error: "The selected release has no installer for this computer." };
      found = { release, asset, notes: release.notes, localized: release.localized };
    }
    if (!found) await check();
    if (!found) return { ok: false, error: status.error ?? "No newer Colonia for this computer." };
    const { release, asset } = found;
    const p = platformOf(process.platform, process.arch);
    const zip = bundle && p ? desktopAssetFor(release.assets, release.version, p, "zip") : undefined;
    try {
      if (bundle && zip) staged = await stageMac(release, zip, bundle);
      else if (appImage) staged = await stageAppImage(release, asset, appImage);
      else if (process.platform === "win32") {
        if (folderFailed.has(release.version))
          log(`unpacked update: ${release.version} did not go in last time, the installer goes instead`);
        const winZip =
          p && !folderFailed.has(release.version)
            ? desktopAssetFor(release.assets, release.version, p, "zip")
            : undefined;
        const unpacked = winZip
          ? await stageWindowsFolder(release, winZip).catch((err: unknown) => {
              log(
                `unpacked update failed, the installer goes instead: ${err instanceof Error ? err.message : String(err)}`,
              );
              return undefined;
            })
          : undefined;
        staged = unpacked ?? (await stageWindows(release, asset));
      } else {
        // macOS can keep the app out of Downloads: the installer is as good from the temporary folder.
        const kind = await installKind;
        const file = await saveInFirst([app.getPath("downloads"), app.getPath("temp")], asset.name, (to) =>
          fetchChecked(release, asset, to),
        );
        pkgCommand = kind ? packageCommand(kind, file) : undefined;
        const open = async () => {
          // On Linux opening the file would run it unasked (an AppImage) or open an archive (a zip): it is only shown.
          if (process.platform === "linux") {
            if (file.endsWith(".AppImage")) fs.chmodSync(file, 0o755);
            shell.showItemInFolder(file);
            return;
          }
          const opened = await shell.openPath(file);
          if (opened) shell.showItemInFolder(file);
        };
        if (deferOpen) {
          staged = {
            version: release.version,
            restart: () => {
              void open();
            },
          };
          return { ok: true, ready: true };
        }
        await open();
        return { ok: true, ready: false };
      }
      return { ok: true, ready: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function stageMac(release: Release, zip: ReleaseAsset, old: string): Promise<Staged> {
    // Beside the running app, so the swap is a rename on the same disk.
    const stage = path.join(path.dirname(old), `.Colonia-${release.version}.update`);
    await fs.promises.rm(stage, { recursive: true, force: true });
    await fs.promises.mkdir(stage, { mode: 0o700 });
    const file = path.join(stage, zip.name);
    try {
      await fetchChecked(release, zip, file);
      await run("/usr/bin/ditto", ["-x", "-k", file, stage], { windowsHide: true });
    } catch (err) {
      await fs.promises.rm(stage, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(file, { force: true });
    }
    const name = fs.readdirSync(stage).find((f) => f.endsWith(".app"));
    if (!name) {
      await fs.promises.rm(stage, { recursive: true, force: true });
      throw new Error(`${zip.name} has no app in it`);
    }
    const next = path.join(stage, name);
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", next], { windowsHide: true }).catch(() => undefined);
    const swap = (relaunch: boolean) => {
      swapping = true;
      const args = [String(process.pid), old, next, stage, relaunch ? "1" : "0", opts.logFile ?? ""];
      spawn("/bin/sh", ["-c", SWAP_MAC, "colonia-update", ...args], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    };
    return {
      version: release.version,
      restart: () => {
        swap(true);
        opts.quit();
      },
      onQuit: () => swap(false),
    };
  }

  async function stageAppImage(release: Release, asset: ReleaseAsset, target: string): Promise<Staged> {
    const file = path.join(path.dirname(target), `.${asset.name}.download`);
    await fetchChecked(release, asset, file);
    // Keep the verified bytes separate until the native coordinator authorizes activation.
    fs.chmodSync(file, 0o755);
    let applied = false;
    const activate = () => {
      if (applied) return;
      fs.renameSync(file, target);
      applied = true;
    };
    return {
      version: release.version,
      restart: () => {
        activate();
        app.relaunch({ execPath: target, args: [] });
        opts.quit();
      },
      onQuit: activate,
    };
  }

  /** ARRANQUE-RAPIDO-1 · Deja la versión nueva descomprimida al lado de la instalada; el reinicio sólo cambia nombres. */
  async function stageWindowsFolder(release: Release, zip: ReleaseAsset): Promise<Staged | undefined> {
    const exe = opts.execPath ?? process.execPath;
    const old = path.dirname(exe);
    if (path.basename(exe).toLowerCase() !== "colonia.exe" || !canWrite(path.dirname(old))) return undefined;
    const stage = path.join(path.dirname(old), `.colonia-${release.version}.update`);
    await fs.promises.rm(stage, { recursive: true, force: true });
    await fs.promises.mkdir(stage, { recursive: true, mode: 0o700 });
    const file = path.join(stage, zip.name);
    const unpackTo = path.join(stage, "app");
    try {
      await fetchChecked(release, zip, file);
      const unzip =
        opts.unzip ??
        ((z: string, into: string) =>
          run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", z, "-C", into], {
            windowsHide: true,
            maxBuffer: 1 << 20,
          }).then(() => undefined));
      fs.mkdirSync(unpackTo);
      await unzip(file, unpackTo);
    } catch (err) {
      await fs.promises.rm(stage, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(file, { force: true });
    }
    // The zip may carry the app at its root or inside one folder.
    const inner = fs.existsSync(path.join(unpackTo, "Colonia.exe"))
      ? unpackTo
      : fs
          .readdirSync(unpackTo)
          .map((n) => path.join(unpackTo, n))
          .find((d) => fs.existsSync(path.join(d, "Colonia.exe")));
    if (!inner) {
      await fs.promises.rm(stage, { recursive: true, force: true });
      throw new Error(`${zip.name} has no Colonia.exe in it`);
    }
    // The uninstaller the NSIS install left is not in the zip: it keeps working from the new folder.
    for (const n of fs.readdirSync(old))
      if (/^Uninstall .*\.exe$/i.test(n) && !fs.existsSync(path.join(inner, n)))
        fs.copyFileSync(path.join(old, n), path.join(inner, n));
    const script = path.join(stage, "swap.ps1");
    fs.writeFileSync(script, SWAP_WIN);
    const launcher = path.join(stage, "launch.vbs");
    fs.writeFileSync(launcher, LAUNCH_VBS);
    fs.writeFileSync(
      path.join(stage, "recover.ps1"),
      recoverScript(old, path.join(stage, "previous"), inner, stage, opts.logFile ?? ""),
    );
    const swap = (relaunch: boolean) => {
      if (!fs.existsSync(inner)) {
        staged = undefined;
        throw new Error("The new version is no longer ready. Check for updates again.");
      }
      swapping = true;
      // ACTUALIZA-REABRE-1 · Si al volver a abrir sigue la versión anterior, este marcador dice que el cambio no entró.
      fs.writeFileSync(path.join(stage, "restarting"), app.getVersion());
      const args = [
        "//B",
        "//Nologo",
        launcher,
        script,
        String(process.pid),
        old,
        inner,
        stage,
        relaunch ? "1" : "0",
        opts.logFile ?? "",
        release.version,
      ];
      // SWAP-RAPIDO-1 · Nunca con la carpeta de trabajo dentro de la instalación (la de Colonia, si la abrió el acceso directo).
      const child = start("wscript.exe", args, {
        cwd: path.dirname(old),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", (error) => log(`swap did not start: ${error.message}`));
      if (child.pid === undefined) {
        swapping = false;
        staged = undefined;
        throw new Error("The update did not start. Check for updates again.");
      }
      child.unref();
    };
    return {
      version: release.version,
      restart: () => {
        swap(true);
        opts.quit();
      },
      onQuit: () => swap(false),
    };
  }

  async function stageWindows(release: Release, asset: ReleaseAsset): Promise<Staged> {
    const root = path.join(app.getPath("userData"), "update-installers");
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await fs.promises.mkdtemp(path.join(root, "download-"));
    const file = path.join(directory, asset.name);
    try {
      await fetchChecked(release, asset, file);
    } catch (error) {
      await fs.promises.rm(directory, { recursive: true, force: true });
      throw error;
    }
    const launch = (args: string[]) => {
      // A cleaned temporary folder is the common way to lose it: say so instead of quitting into nothing.
      if (!fs.existsSync(file)) {
        staged = undefined;
        throw new Error("The new version is no longer ready. Check for updates again.");
      }
      const child = start(file, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", (error) => log(`installer did not start: ${error.message}`));
      // A spawn that failed has no pid at once; its 'error' event only follows later.
      if (child.pid === undefined) {
        staged = undefined;
        throw new Error("The installer did not start. Check for updates again.");
      }
      child.unref();
    };
    return {
      version: release.version,
      // Al reiniciar, NSIS instala en silencio y vuelve a abrir Colonia cuando termina.
      restart: () => {
        launch(["--updated", "/S", "--force-run"]);
        swapping = true; // the quit below must not start the installer a second time
        setTimeout(opts.quit, 1000);
      },
      // The owner quit: install without a window and do not reopen.
      onQuit: () => launch(["--updated", "/S"]),
    };
  }

  return {
    enabled,
    mode,
    /** "deb"/"rpm": this Colonia came from the system's package, so its update is one too (known shortly after start). */
    systemPackage: () => pkg,
    /** The command that installs the downloaded package (sudo apt/dnf install …), once it is shown. */
    packageCommand: () => pkgCommand,
    ...(place ? { place } : {}),
    /** Adds a line to the update log (steps decided outside this updater, like a coordinated server update). */
    log,
    status: current,
    check,
    install,
    discard() {
      generation++;
      staged = undefined;
      publish();
    },
    /** Quits and opens the newer Colonia; a failed answer means the app keeps running as it is. */
    restart(): RestartAnswer {
      if (!staged) {
        log("restart: nothing is ready");
        return { ok: false, error: "The new version is no longer ready. Check for updates again." };
      }
      // ACTUALIZA-REABRE-1 · Nunca instalar una descarga más vieja que la última publicada: se descarta y se baja la nueva.
      if (status.latest && compareVersions(status.latest, staged.version) > 0) {
        log(`restart: ${staged.version} is older than ${status.latest}, downloading ${status.latest}`);
        const latest = status.latest;
        staged = undefined;
        void install(latest);
        return { ok: false, error: `Colonia ${latest} is downloading. Restart when it is ready.` };
      }
      log(`restart: ${staged.version}`);
      try {
        staged.restart();
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log(`restart failed: ${error}`);
        return { ok: false, error };
      }
    },
    /** Quitting with a newer Colonia ready puts it in place (where that needs no installer window). */
    quitting() {
      if (staged?.onQuit && !swapping) {
        log(`quit: putting ${staged.version} in place`);
        const ready = staged;
        // Once only: a second quit must not start it again; a failure here must not throw inside will-quit.
        staged = undefined;
        try {
          ready.onQuit?.();
        } catch (error) {
          log(`quit: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    /** `found(status)`: a background check found a newer Colonia (auto mode then downloads it on its own). */
    start(found: (s: DesktopUpdate) => void) {
      if (!enabled) return;
      const removals: Promise<void>[] = [];
      const remove = (dir: string) => {
        removals.push(
          fs.promises.rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
            log(`update cleanup postponed: ${error instanceof Error ? error.message : String(error)}`);
          }),
        );
      };
      // Running means the last installer is done: it and any before it go.
      if (process.platform === "win32") {
        removeOldInstallers(os.tmpdir());
        remove(path.join(app.getPath("userData"), "update-installers"));
        // ARRANQUE-RAPIDO-1 · A folder left from an update that was never applied is downloaded again when needed.
        // SWAP-SIEMPRE-ABRE-1 · One the swap marked failed stays (download and old copy) until that version is in.
        const parent = path.dirname(path.dirname(opts.execPath ?? process.execPath));
        try {
          for (const f of fs.readdirSync(parent)) {
            const v = /^\.colonia-(.+)\.update$/.exec(f)?.[1];
            if (!v) continue;
            const dir = path.join(parent, f);
            const failed = path.join(dir, "failed");
            // ACTUALIZA-REABRE-1 · Se reinició para ponerla y sigue la anterior: el cambio no corrió; va el instalador.
            if (v !== app.getVersion() && !fs.existsSync(failed) && fs.existsSync(path.join(dir, "restarting")))
              fs.writeFileSync(failed, `restarted into ${app.getVersion()}, not ${v}`);
            if (v === app.getVersion() && fs.existsSync(path.join(dir, "restarting"))) log(`installed: ${v}`);
            if (v !== app.getVersion() && fs.existsSync(failed)) {
              folderFailed.add(v);
              log(
                `unpacked update ${v} did not go in (${fs.readFileSync(failed, "utf8").trim()}): the installer goes next`,
              );
              continue;
            }
            remove(dir);
          }
        } catch {
          // Nothing to clean, or a file still held: it goes the next time.
        }
      }
      if (bundle) {
        try {
          for (const f of fs.readdirSync(path.dirname(bundle)))
            if (/^\.Colonia-.+\.update$/.test(f)) remove(path.join(path.dirname(bundle), f));
        } catch (error) {
          log(`update cleanup postponed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      cleanup = Promise.all(removals).then(() => undefined);
      const tick = (ms: number) => {
        timer = setTimeout(
          () =>
            void check()
              .then((s) => {
                // ACTUALIZA-REABRE-1 · Una descarga lista pero más vieja que la publicada no frena la nueva.
                if (s.latest && s.ready !== s.latest && !s.downloading) found(s);
              })
              .finally(() => tick(RELEASE_CHECK_EVERY_MS)),
          ms,
        );
        timer.unref?.();
      };
      tick(FIRST_MS);
      // DESCARGA-REANUDA-1 · Al despertar el equipo se mira enseguida: una descarga cortada por la suspensión vuelve.
      wake = () => {
        if (timer) clearTimeout(timer);
        tick(10_000);
      };
    },
    /** DESCARGA-REANUDA-1 · The computer woke up: check (and, in auto mode, download) again shortly. */
    resumed() {
      wake?.();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
