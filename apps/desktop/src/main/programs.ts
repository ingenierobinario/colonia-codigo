// PROGRAMAS-1: the owner's desktop programs, pinned in the sidebar and opened with one click. They live on THIS
// computer (userData/programs.json), not in the core: a path means nothing on another machine. A program enters
// only through the system's own file dialog, and the panel launches it by id — never by a path the page sends — so a
// page can never make Colonia run something the owner did not pick.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Program = { id: string; name: string; path: string };
export type ProgramView = Program & { icon?: string };

type Deps = {
  file: string;
  platform: NodeJS.Platform;
  /** The system's open dialog: the chosen paths, or none if cancelled. */
  pick: (filters: { name: string; extensions: string[] }[]) => Promise<string[]>;
  openPath: (p: string) => Promise<string>;
  icon: (p: string) => Promise<string | undefined>;
};

/** What the dialog offers on each system: programs, shortcuts and launchers. */
export function programFilters(platform: NodeJS.Platform) {
  if (platform === "win32") return [{ name: "Programas", extensions: ["exe", "lnk", "bat", "cmd", "url"] }];
  if (platform === "darwin") return [{ name: "Aplicaciones", extensions: ["app"] }];
  return [];
}

/** "C:\\…\\Code.exe" → "Code"; "/Applications/Slack.app" → "Slack"; "firefox.desktop" → "firefox". */
export function programName(p: string): string {
  const base = path.basename(p.replace(/[\\/]+$/, ""));
  return base.replace(/\.(exe|lnk|bat|cmd|url|app|desktop|appimage|sh)$/i, "") || base;
}

export function createPrograms(d: Deps) {
  const read = (): Program[] => {
    try {
      const list = JSON.parse(fs.readFileSync(d.file, "utf8"));
      return Array.isArray(list)
        ? list.filter(
            (x): x is Program => typeof x?.id === "string" && typeof x?.name === "string" && typeof x?.path === "string",
          )
        : [];
    } catch {
      return [];
    }
  };
  const write = (list: Program[]) => {
    fs.mkdirSync(path.dirname(d.file), { recursive: true });
    fs.writeFileSync(d.file, JSON.stringify(list, null, 2));
  };
  const view = async (): Promise<ProgramView[]> =>
    Promise.all(read().map(async (p) => ({ ...p, icon: await d.icon(p.path).catch(() => undefined) })));

  return {
    list: view,
    async add(): Promise<ProgramView[]> {
      const chosen = await d.pick(programFilters(d.platform));
      if (chosen.length) {
        const list = read();
        for (const p of chosen) {
          if (list.some((x) => x.path === p)) continue;
          let n = 1;
          while (list.some((x) => x.id === `p${n}`)) n++;
          list.push({ id: `p${n}`, name: programName(p), path: p });
        }
        write(list);
      }
      return view();
    },
    async rename(id: string, name: string): Promise<ProgramView[]> {
      const clean = name.trim().slice(0, 60);
      if (clean) write(read().map((p) => (p.id === id ? { ...p, name: clean } : p)));
      return view();
    },
    async remove(id: string): Promise<ProgramView[]> {
      write(read().filter((p) => p.id !== id));
      return view();
    },
    /** Opens the program; "" when it started, else why not. */
    async launch(id: string): Promise<string> {
      const p = read().find((x) => x.id === id);
      if (!p) return "not found";
      if (!fs.existsSync(p.path)) return "missing";
      // Linux: a plain executable (an AppImage, a script) is run; a .desktop or anything else goes to the system.
      if (d.platform === "linux" && !/\.desktop$/i.test(p.path)) {
        try {
          fs.accessSync(p.path, fs.constants.X_OK);
          const child = spawn(p.path, [], { detached: true, stdio: "ignore", cwd: path.dirname(p.path) });
          child.on("error", () => {});
          child.unref();
          return "";
        } catch {
          // not executable: let the system open it
        }
      }
      return d.openPath(p.path);
    },
  };
}
