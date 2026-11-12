// How a Linux Colonia was installed, so opening and updating keep to the same kind of file: an AppImage replaces
// itself, while a Colonia that came from the .deb or the .rpm lives in /opt/Colonia, owned by the system's package
// manager, and its update is the newer package (an AppImage beside it would be a second, unrelated copy). Plain Node
// only: the desktop app, the installer and the release checks inside Debian and Fedora containers all run it.
import { spawn } from "node:child_process";

export type LinuxInstall = "appimage" | "deb" | "rpm" | "other";
export type PackageKind = "deb" | "rpm";

/** A short query whose exit status (null: it could not run) and printed words are all that matter. */
export type PackageRun = (command: string, args: string[]) => Promise<{ status: number | null; stdout?: string }>;

/** electron-builder's .deb and .rpm both put the app in /opt/<productName>, as <executableName>. */
export const PACKAGE_DIR = "/opt/Colonia/";
export const PACKAGE_APP = `${PACKAGE_DIR}colonia`;

export const queryRun: PackageRun = (command, args) =>
  new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, stdout });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 10_000);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => finish(code));
  });

/** Which package database owns `file`, and the version it installed. Undefined for a copy nobody owns. */
export async function packageOwner(
  file: string,
  run: PackageRun = queryRun,
): Promise<{ kind: PackageKind; version: string } | undefined> {
  if (!file.startsWith(PACKAGE_DIR)) return undefined;
  // Asking the package databases tells a real package from a copy someone unpacked there by hand.
  const deb = await run("dpkg", ["-S", file]);
  if (deb.status === 0) {
    const name = deb.stdout?.split(":")[0]?.trim();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg-query's own field syntax, not a template.
    const version = name ? await run("dpkg-query", ["-W", "-f=${Version}", name]) : undefined;
    return { kind: "deb", version: version?.status === 0 ? (version.stdout ?? "").trim() : "" };
  }
  const rpm = await run("rpm", ["-qf", "--qf", "%{VERSION}", file]);
  if (rpm.status === 0) return { kind: "rpm", version: (rpm.stdout ?? "").trim() };
  return undefined;
}

export async function linuxInstall(
  env: NodeJS.ProcessEnv,
  execPath: string,
  run: PackageRun = queryRun,
): Promise<LinuxInstall> {
  if (env.APPIMAGE) return "appimage";
  return (await packageOwner(execPath, run))?.kind ?? "other";
}

/** The one command that puts a downloaded package in, for the owner to paste in a terminal. */
export function packageCommand(kind: PackageKind, file: string): string {
  const quoted = `'${file.replaceAll("'", `'\\''`)}'`;
  return kind === "deb" ? `sudo apt install ${quoted}` : `sudo dnf install ${quoted}`;
}

/** The same install, run directly by something that already has the privileges. */
export function packageInstallArgs(kind: PackageKind, file: string): [string, string[]] {
  return kind === "deb" ? ["apt-get", ["install", "-y", file]] : ["dnf", ["install", "-y", file]];
}
