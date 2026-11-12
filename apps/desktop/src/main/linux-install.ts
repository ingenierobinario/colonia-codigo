// How this Linux Colonia was installed, so an update brings the same kind of file: an AppImage replaces itself, while
// a Colonia that came from the .deb or the .rpm lives in /opt/Colonia, owned by the system's package manager, and its
// update is the newer package (an AppImage there would be a second, unrelated copy). No Electron here: the release
// checks run it with plain Node inside Debian and Fedora containers.
import { runCommand } from "./run-command.ts";

export type LinuxInstall = "appimage" | "deb" | "rpm" | "other";

type Run = (command: string, args: string[]) => Promise<{ status: number | null }>;

const defaultRun: Run = (command, args) => runCommand(command, args, { timeout: 10_000, stdout: false });

/** electron-builder's .deb and .rpm both put the app in /opt/<productName>. */
export const PACKAGE_DIR = "/opt/Colonia/";

export async function linuxInstall(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  run: Run = defaultRun,
): Promise<LinuxInstall> {
  if (env.APPIMAGE) return "appimage";
  if (!execPath.startsWith(PACKAGE_DIR)) return "other";
  // Asking the package databases tells a real package from a copy someone unpacked there by hand.
  if ((await run("dpkg", ["-S", execPath])).status === 0) return "deb";
  if ((await run("rpm", ["-qf", execPath])).status === 0) return "rpm";
  return "other";
}

/** The one command that puts a downloaded package in, for the owner to paste in a terminal. */
export function packageCommand(kind: "deb" | "rpm", file: string): string {
  const quoted = `'${file.replaceAll("'", `'\\''`)}'`;
  return kind === "deb" ? `sudo apt install ${quoted}` : `sudo dnf install ${quoted}`;
}
