// Finding a program the owner installed, also for a core started without the login shell's PATH (launchd, systemd, a
// Windows session older than the install), and what Node can start in place of a Windows .cmd shim.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;
type Exists = (file: string) => boolean;

const win = path.win32;

/** Windows' environment names ignore case; a plain object does not. `key` in upper case. */
export const envOf = (env: Env, key: string) => env[Object.keys(env).find((k) => k.toUpperCase() === key) ?? key];

/** Where package managers put programs (Homebrew on both Mac kinds, MacPorts, Linuxbrew, snap, the system folders). */
const USUAL_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/opt/local/bin",
  "/home/linuxbrew/.linuxbrew/bin",
  "/snap/bin",
];

/** Where version managers of Node and friends put what `npm install -g` installs, under the user's folder. */
const USER_DIRS = [
  [".local", "bin"],
  [".volta", "bin"],
  [".bun", "bin"],
  [".asdf", "shims"],
  [".local", "share", "mise", "shims"],
  [".npm-global", "bin"],
  [".local", "share", "fnm", "aliases", "default", "bin"],
];

const names = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** The highest of the entries that look like a version, compared as versions (v9 < v22). */
const newest = (all: string[], named: RegExp) =>
  all.filter((n) => named.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

/** nvm keeps one folder per Node version: the newest installed one, as a new shell would most likely use. */
export function nvmBin(home = os.homedir()): string | undefined {
  const versions = path.join(home, ".nvm", "versions", "node");
  const node = newest(names(versions), /^v\d+\.\d+\.\d+$/);
  return node ? path.join(versions, node, "bin") : undefined;
}

/**
 * Where Windows installers and Node managers put command-line programs: npm's global folder, pnpm, Volta, Bun, Scoop,
 * nvm-windows, fnm, mise, winget. A core started at login keeps the PATH from before the owner installed a tool, and
 * some managers only add theirs from the shell's profile.
 */
export function windowsDirs(env: Env = process.env, list: (dir: string) => string[] = names): string[] {
  const at = (key: string) => envOf(env, key) || undefined;
  const home = at("USERPROFILE") ?? os.homedir();
  const local = at("LOCALAPPDATA") ?? win.join(home, "AppData", "Local");
  const roaming = at("APPDATA") ?? win.join(home, "AppData", "Roaming");
  const programs = at("PROGRAMW6432") ?? at("PROGRAMFILES") ?? "C:\\Program Files";
  const pnpm = at("PNPM_HOME") ?? win.join(local, "pnpm");
  const scoop = at("SCOOP") ?? win.join(home, "scoop");
  const nvm = at("NVM_SYMLINK");
  // winget unpacks Node's zip in a folder per package with the version in its name, and links nothing.
  const packages = win.join(local, "Microsoft", "WinGet", "Packages");
  const zips = list(packages)
    .filter((n) => /^OpenJS\.NodeJS/i.test(n))
    .flatMap((pkg) => {
      const node = newest(list(win.join(packages, pkg)), /^node-v\d+\.\d+\.\d+/);
      return node ? [win.join(packages, pkg, node)] : [];
    });
  return [
    win.join(home, ".local", "bin"),
    win.join(roaming, "npm"),
    pnpm,
    win.join(pnpm, "bin"),
    win.join(at("VOLTA_HOME") ?? win.join(local, "Volta"), "bin"),
    win.join(programs, "Volta"),
    win.join(at("BUN_INSTALL") ?? win.join(home, ".bun"), "bin"),
    win.join(scoop, "shims"),
    ...["nodejs", "nodejs-lts"].flatMap((app) => [
      win.join(scoop, "apps", app, "current"),
      win.join(scoop, "apps", app, "current", "bin"),
    ]),
    ...(nvm ? [nvm] : []),
    win.join(at("FNM_DIR") ?? win.join(roaming, "fnm"), "aliases", "default"),
    win.join(at("MISE_DATA_DIR") ?? win.join(local, "mise"), "shims"),
    win.join(local, "Microsoft", "WinGet", "Links"),
    ...zips,
    win.join(programs, "nodejs"),
  ];
}

/** The usual folders plus the user's own (~/.local/bin, where install.sh and pipx put programs, and version managers'). */
const usualDirs = () => {
  if (process.platform === "win32") return windowsDirs();
  const home = os.homedir();
  const nvm = nvmBin(home);
  return [...USUAL_DIRS, ...USER_DIRS.map((d) => path.join(home, ...d)), ...(nvm ? [nvm] : [])];
};

/**
 * A PATH with the usual program folders it lacks added at its end, those that exist. A core the desktop app or launchd
 * started gets only the system's folders, so the shells agents run would miss what the owner installed.
 */
export function withUsualDirs(envPath: string, dirs = usualDirs(), platform = process.platform): string {
  const sep = platform === "win32" ? ";" : path.delimiter;
  // Windows names the same folder in any case, with or without a closing separator.
  const key = (d: string) => (platform === "win32" ? d.replace(/[\\/]+$/, "").toLowerCase() : d);
  const have = new Set(envPath.split(sep).filter(Boolean).map(key));
  const add: string[] = [];
  for (const d of dirs) {
    if (have.has(key(d)) || !fs.existsSync(d)) continue;
    have.add(key(d));
    add.push(d);
  }
  return [envPath, ...add].filter(Boolean).join(sep);
}

/** A program that starts by itself: on Windows an .exe or .com, never a script that needs a shell (see findCommand). */
export function findProgram(name: string, envPath = process.env.PATH ?? ""): string | undefined {
  const windows = process.platform === "win32";
  const kinds = !windows || /\.(exe|com)$/i.test(name) ? [name] : [`${name}.exe`, `${name}.com`];
  for (const dir of [...envPath.split(path.delimiter), ...usualDirs()].filter(Boolean))
    for (const n of kinds) {
      const file = path.join(dir, n);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {}
    }
  return undefined;
}

/**
 * A command on Windows, on the PATH and then in the usual folders: a program that starts by itself (.exe, .com)
 * wherever it is, else a .cmd or .bat shim, which is how `npm install -g` and most Node managers install a CLI.
 */
export function findCommand(
  name: string,
  envPath = process.env.PATH ?? "",
  dirs = usualDirs(),
  exists: Exists = fs.existsSync,
): string | undefined {
  const folders = [...envPath.split(";").map((d) => d.trim().replace(/^"(.*)"$/, "$1")), ...dirs].filter(Boolean);
  const kinds = /\.(exe|com|cmd|bat)$/i.test(name)
    ? [[""]]
    : [
        [".exe", ".com"],
        [".cmd", ".bat"],
      ];
  for (const exts of kinds)
    for (const dir of folders)
      for (const ext of exts) {
        const file = win.join(dir, `${name}${ext}`);
        if (exists(file)) return file;
      }
  return undefined;
}

/** Whether a shell finds `name` on this PATH: on Windows with any of PATHEXT's extensions (.exe, .cmd, .bat…). */
export function onPath(name: string, envPath = process.env.PATH ?? ""): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return envPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => fs.existsSync(path.join(dir, `${name}${e.toLowerCase()}`))));
}

/** A program and the arguments that go before the caller's own. */
export type Spawnable = { file: string; args: string[] };

/** Node refuses to start a .cmd or .bat without a shell (spawn EINVAL), and a shell would reinterpret the arguments. */
export function isWindowsShim(file: string, platform: string = process.platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(file);
}

type ShimDeps = { exists?: Exists; find?: (name: string) => string | undefined; env?: Env };

/** Statements of a shim that start nothing. An `if` counts only as a bare test: its body is read on its own. */
const QUIET =
  /^(?:(?:echo|goto|exit|setlocal|endlocal|title|else)\b|if\s+(?:not\s+)?(?:exist|defined)\s+(?:"[^"]*"|\S+)$)/i;
const SET = /^set\s+(?:"([^="\s]+)=([^"]*)"|([^="\s/]+)=(.*))$/i;
/** Variables a shim sets for the program it starts, which starts the same without them. */
const UNREAD_OK = new Set(["PATHEXT", "NODE_PATH"]);

/**
 * What a .cmd shim starts, read from its text: the program and its fixed arguments. Covers what package managers
 * write (npm, pnpm, Yarn, Volta, Scoop, mise): variables, `%~dp0` and one start line ending in `%*`. Anything that
 * does more (other commands, redirection, variables exported to the program) has no answer, rather than a wrong one.
 */
export function shimTarget(text: string, shim: string, deps: ShimDeps = {}): Spawnable | undefined {
  const exists = deps.exists ?? fs.existsSync;
  const find = deps.find ?? ((name: string) => findCommand(name));
  const env = deps.env ?? process.env;
  const sets = new Map<string, string[]>();
  const read: { text: string; own?: string }[] = [];
  const starts: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^@\s*/, "");
    if (/^(?::|rem\b)/i.test(line)) continue;
    if (/^for\b/i.test(line)) {
      read.push({ text: line });
      continue;
    }
    for (const piece of line.match(/(?:"[^"]*"|[^"&|()])+/g) ?? []) {
      const part = piece.trim().replace(/^@\s*/, "");
      if (!part) continue;
      if (/^call\s+:/i.test(part)) continue;
      const set = SET.exec(part);
      if (set) {
        const name = (set[1] ?? set[3] ?? "").toUpperCase();
        const value = set[1] !== undefined ? (set[2] ?? "") : (set[4] ?? "").trim();
        sets.set(name, [...(sets.get(name) ?? []), value]);
        read.push({ text: value, own: name });
      } else if (/%\*$/.test(part)) {
        const start = part.slice(0, -2).trim();
        starts.push(start);
        read.push({ text: start });
      } else if (/^setlocal\b.*delayedexpansion/i.test(part) || !QUIET.test(part)) {
        return undefined;
      } else read.push({ text: part });
    }
  }
  // A variable nothing reads back is one the script hands to the program: it would start without it.
  for (const name of sets.keys()) {
    if (UNREAD_OK.has(name)) continue;
    const use = `%${name}%`;
    if (!read.some((r) => r.own !== name && r.text.toUpperCase().includes(use))) return undefined;
  }

  const at = win.parse(win.resolve(shim));
  const drive = at.root.replace(/[\\/]+$/, "");
  const self: Record<string, string> = {
    d: drive,
    p: `${at.dir.slice(drive.length).replace(/[\\/]+$/, "")}\\`,
    n: at.name,
    x: at.ext,
  };
  const isPath = (v: string) => /[\\/]/.test(v);
  const expand = (value: string, busy: string[]): string | undefined => {
    let bad = false;
    const out = value
      .replace(/%~([a-z]*)0/gi, (_all, mods: string) => {
        const m = mods.toLowerCase();
        if (!m || m.includes("f")) return win.join(at.dir, at.base);
        if (/[^dpnx]/.test(m)) bad = true;
        return ["d", "p", "n", "x"].map((k) => (m.includes(k) ? self[k] : "")).join("");
      })
      .replace(/%([^%\s:]+)%/g, (_all, name: string) => {
        const v = valueFor(name.toUpperCase(), busy);
        if (v === undefined) bad = true;
        return v ?? "";
      });
    return bad || out.includes("%") ? undefined : out;
  };
  const valueFor = (name: string, busy: string[]): string | undefined => {
    const own = busy.includes(name) ? undefined : sets.get(name);
    if (!own) return envOf(env, name);
    const options = own.map((v) => expand(v, [...busy, name])).filter((v): v is string => v !== undefined);
    // Set twice means "this one if it is there, else that": the path that exists, else the bare name.
    return options.find((v) => isPath(v) && exists(win.normalize(v))) ?? options.find((v) => !isPath(v)) ?? options[0];
  };
  const program = (named: string): string | undefined => {
    if (!isPath(named)) return find(named);
    const file = win.normalize(named);
    const kinds = win.extname(file) ? [""] : [".exe", ".com", ".cmd", ".bat"];
    return kinds.map((k) => `${file}${k}`).find((f) => exists(f));
  };

  const folder = `${at.dir.replace(/[\\/]+$/, "")}\\`.toLowerCase();
  for (const start of starts) {
    if (/[<>^]/.test(start.replace(/"[^"]*"/g, ""))) continue;
    const whole = expand(start.replace(/^call\s+/i, ""), []);
    const words = whole?.match(/(?:"[^"]*"|[^\s"])+/g)?.map((w) => w.replace(/"/g, ""));
    const first = words?.[0];
    const file = first ? program(first) : undefined;
    if (!words || !file) continue;
    const args = words.slice(1).map((w) => (w.toLowerCase().startsWith(folder) ? win.normalize(w) : w));
    return { file, args };
  }
  return undefined;
}

/**
 * What to hand to spawn in place of `program`: itself, or what its shim starts when it is a Windows .cmd or .bat
 * (a shim of a shim too, as Yarn and Scoop write them). Undefined when the script cannot be reduced to one program.
 */
export function spawnable(
  program: string,
  args: string[] = [],
  platform: string = process.platform,
  depth = 0,
): Spawnable | undefined {
  if (!isWindowsShim(program, platform)) return { file: program, args: [...args] };
  if (depth > 2) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(program, "utf8");
  } catch {
    return undefined;
  }
  const target = shimTarget(text, program);
  return target ? spawnable(target.file, [...target.args, ...args], platform, depth + 1) : undefined;
}

/** `spawnable`, or an error the owner can act on instead of Node's bare `spawn EINVAL`. */
export function toSpawn(program: string, args: string[] = [], platform: string = process.platform): Spawnable {
  const found = spawnable(program, args, platform);
  if (found) return found;
  throw new Error(
    `${program} is a Windows script that does more than start a program, or the program it starts was not found; install its native executable`,
  );
}
