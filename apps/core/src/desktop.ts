// What the owner's machine does with a file outside Colonia: show it in Finder (Explorer, the file manager), open it in its
// default app or move it to the system trash, where it can still be recovered. Paths go as arguments or environment, never inside a script.
import { execFile } from "node:child_process";
import path from "node:path";

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
      return run("xdg-open", [path.dirname(abs)]);
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
      return run("gio", ["trash", abs]);
    },
  };
}

export const systemDesktop: DesktopOps = desktopOps();
