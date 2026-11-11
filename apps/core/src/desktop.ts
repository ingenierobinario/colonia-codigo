// What the owner's machine does with a file outside Colonia: show it in Finder (Explorer, the file manager), open it in its
// default app or move it to the system trash, where it can still be recovered. Paths go as arguments or environment, never inside a script.
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type DesktopOps = {
  reveal(abs: string): Promise<void>;
  open(abs: string): Promise<void>;
  trash(abs: string): Promise<void>;
};

type Run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<void>;

const runCommand: Run = (cmd, args, env) =>
  new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { timeout: 15_000, windowsHide: true, env: { ...process.env, ...env } }, (err) =>
      err ? reject(err) : resolve(),
    ),
  );

/** The system's ways, for `platform`; `run` is injected by tests. */
export function desktopOps(platform: NodeJS.Platform = process.platform, run: Run = runCommand): DesktopOps {
  return {
    reveal(abs) {
      if (platform === "darwin") return run("open", ["-R", abs]);
      if (platform === "win32") return run("explorer.exe", [`/select,${abs}`]).catch(() => {});
      // The file manager selects the file; with --print-reply a missing service rejects, and the folder opens instead.
      // array:string: splits on commas, so a comma in the name goes encoded.
      return run("dbus-send", [
        "--session",
        "--print-reply",
        "--reply-timeout=5000",
        "--dest=org.freedesktop.FileManager1",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1.ShowItems",
        `array:string:${pathToFileURL(abs).href.replaceAll(",", "%2C")}`,
        "string:",
      ]).catch(() => run("xdg-open", [path.dirname(abs)]));
    },
    open(abs) {
      if (platform === "darwin") return run("open", [abs]);
      // The path goes by environment: cmd's `start` would read & ^ % in it as commands. The shell's default verb, as a
      // double click (a type with no app gets the system's chooser).
      if (platform === "win32")
        return run(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(New-Object -ComObject Shell.Application).ShellExecute($env:COLONIA_OPEN_PATH)",
          ],
          { COLONIA_OPEN_PATH: abs },
        );
      return run("xdg-open", [abs]);
    },
    trash(abs) {
      if (platform === "darwin")
        return run("osascript", [
          "-e",
          "on run argv",
          "-e",
          'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
          "-e",
          "end run",
          abs,
        ]);
      // -LiteralPath: plain Test-Path reads [ ] in a name as a wildcard.
      if (platform === "win32")
        return run(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:COLONIA_TRASH_PATH; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }",
          ],
          { COLONIA_TRASH_PATH: abs },
        );
      // gio ships with glib; trash-cli only where gio is missing. A real gio failure is said as it is.
      const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";
      return run("gio", ["trash", abs]).catch((err) => {
        if (!missing(err)) throw err;
        return run("trash-put", [abs]).catch((again) => {
          if (!missing(again)) throw again;
          throw new Error("Colonia could not find a trash tool (gio or trash-cli) on this machine");
        });
      });
    },
  };
}

export const systemDesktop: DesktopOps = desktopOps();
