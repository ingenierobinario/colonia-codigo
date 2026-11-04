// v2 takes Colonia v1's place on this machine: v1's daemon stops for good (two daemons would run the same routines and
// answer the same bots), v1's `colonia` goes, and `colonia` runs this Colonia. v1's files in ~/.colonia stay, to import them.
import fs from "node:fs";
import path from "node:path";

/** The global npm package v1's `colonia` comes from. */
export const V1_PACKAGE = "@ingenierobinario/colonia";
/** v1's daemon in a process list (its npm install or a checkout of it). */
const V1_DAEMON = "colonia/src/host/daemon";

export type Run = (cmd: string, args: string[]) => Promise<{ code: number; out: string }>;

export type TakeoverDeps = {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  run: Run;
  /** v1's daemon answers on its port. */
  v1Running: () => Promise<boolean>;
  /** This Colonia's own command: apps/terminal/src/main.ts, and the program that runs it. */
  terminal: { main: string; exe: string; electron: boolean; appImage: boolean; checkout: boolean };
  wait?: (ms: number) => Promise<void>;
};

export type TakeoverResult = { ok: boolean; detail: string };

/** v1's daemon answers on its port: with v2 running beside it, routines and bots would run twice. */
export async function v1Answers(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stops v1's daemon and its desktop's login item, so neither starts again at the next login. */
async function stopV1(d: TakeoverDeps): Promise<void> {
  const home = d.home;
  if (d.platform === "darwin") {
    for (const label of ["dev.colonia.daemon", "dev.colonia.desktop"]) {
      if (!fs.existsSync(path.join(home, "Library", "LaunchAgents", `${label}.plist`))) continue;
      await d.run("launchctl", ["bootout", `gui/${d.uid}/${label}`]);
      // A plist left in LaunchAgents loads again at login unless launchd is told it is off.
      await d.run("launchctl", ["disable", `gui/${d.uid}/${label}`]);
    }
  } else if (d.platform === "linux") {
    if (fs.existsSync(path.join(home, ".config", "systemd", "user", "colonia-daemon.service")))
      await d.run("systemctl", ["--user", "disable", "--now", "colonia-daemon.service"]);
    const autostart = path.join(home, ".config", "autostart", "colonia-desktop.desktop");
    if (fs.existsSync(autostart)) fs.renameSync(autostart, `${autostart}.off`);
  } else if (d.platform === "win32") {
    for (const name of ["ColoniaDaemon", "ColoniaDesktop"])
      await d.run("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", name, "/f"]);
    await d.run("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'colonia[\\\\/]src[\\\\/]host[\\\\/]daemon' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ]);
  }
  // One started by hand (`colonia daemon start`) has no service to stop.
  if (d.platform !== "win32") await d.run("pkill", ["-f", V1_DAEMON]);
}

/** Removes v1's global `colonia`; says what to run when that needs administrator rights. */
async function removeV1Command(d: TakeoverDeps): Promise<string | undefined> {
  let left: string | undefined;
  const npm = await d.run("npm", ["ls", "-g", "--depth=0", V1_PACKAGE]);
  if (npm.code === 0 && npm.out.includes(V1_PACKAGE)) {
    const gone = await d.run("npm", ["uninstall", "-g", V1_PACKAGE]);
    if (gone.code !== 0) left = `${d.platform === "win32" ? "" : "sudo "}npm uninstall -g ${V1_PACKAGE}`;
  }
  const pnpm = await d.run("pnpm", ["ls", "-g", "--depth=0"]);
  if (pnpm.code === 0 && pnpm.out.includes(V1_PACKAGE)) await d.run("pnpm", ["remove", "-g", V1_PACKAGE]);
  return left;
}

const quoteSh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Makes `colonia` run this Colonia: the checkout's link, or a launcher next to the one install.sh writes. */
async function linkV2(d: TakeoverDeps): Promise<{ ok: boolean; detail: string }> {
  const { terminal: t } = d;
  if (t.checkout) {
    const linked = await d.run("pnpm", ["--dir", path.resolve(t.main, "../.."), "link", "--global"]);
    return linked.code === 0
      ? { ok: true, detail: "colonia runs this checkout" }
      : { ok: false, detail: `pnpm link failed: ${linked.out.trim().slice(-200)}` };
  }
  // An AppImage's files live in a folder that is gone once it closes: the install line gives a lasting command.
  if (t.appImage)
    return {
      ok: false,
      detail: "for the colonia command, run: curl -fsSL https://colonia.ingenierobinario.com/install.sh | bash",
    };
  const node = t.electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
  if (d.platform === "win32") {
    const bin = path.join(d.home, ".colonia", "v2", "app", "bin");
    fs.mkdirSync(bin, { recursive: true });
    const cmd = `@echo off\r\n${t.electron ? "set ELECTRON_RUN_AS_NODE=1\r\n" : ""}"${t.exe}" --disable-warning=ExperimentalWarning "${t.main}" %*\r\n`;
    // colonia2 too: it reaches this Colonia even where another colonia comes first on the PATH.
    for (const name of ["colonia.cmd", "colonia2.cmd"]) fs.writeFileSync(path.join(bin, name), cmd);
    await d.run("powershell", [
      "-NoProfile",
      "-Command",
      `$p = [Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${bin}')) { [Environment]::SetEnvironmentVariable('Path', ('${bin};' + $p).TrimEnd(';'), 'User') }`,
    ]);
    return { ok: true, detail: "colonia runs this Colonia (open a new terminal)" };
  }
  const bin = path.join(d.home, ".local", "bin");
  const file = path.join(bin, "colonia");
  const alias = () => {
    // colonia2 too: it reaches this Colonia even where another colonia (v1's) comes first on the PATH.
    fs.rmSync(path.join(bin, "colonia2"), { force: true });
    fs.symlinkSync("colonia", path.join(bin, "colonia2"));
  };
  // install.sh's own launcher already runs v2.
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("written by install.sh")) {
    alias();
    return { ok: true, detail: "colonia runs this Colonia" };
  }
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh\n# The Colonia command, written by the Colonia app.\n${node}exec ${quoteSh(t.exe)} --disable-warning=ExperimentalWarning ${quoteSh(t.main)} "$@"\n`,
    { mode: 0o755 },
  );
  alias();
  // Like install.sh: ~/.local/bin goes on the PATH of the shells that do not have it yet.
  for (const rc of [".zshrc", ".bashrc", ".profile"]) {
    const f = path.join(d.home, rc);
    if (fs.existsSync(f) && !fs.readFileSync(f, "utf8").includes(".local/bin"))
      fs.appendFileSync(f, '\n# Added by Colonia\nexport PATH="$HOME/.local/bin:$PATH"\n');
  }
  return { ok: true, detail: "colonia runs this Colonia (open a new terminal)" };
}

export async function takeOverV1(d: TakeoverDeps): Promise<TakeoverResult> {
  const wait = d.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  await stopV1(d);
  let stopped = !(await d.v1Running());
  for (let i = 0; i < 10 && !stopped; i++) {
    await wait(300);
    stopped = !(await d.v1Running());
  }
  const left = await removeV1Command(d);
  const link = await linkV2(d);
  const lines = [
    stopped ? "Colonia v1's daemon is off and will not start at login" : "Colonia v1 still answers: quit it from its own app",
    left ? `v1's colonia needs administrator rights to go: ${left}` : "v1's colonia is gone",
    link.detail,
  ];
  return { ok: stopped && !left && link.ok, detail: lines.join(". ") };
}
