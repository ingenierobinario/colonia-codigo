import fs from "node:fs";

/** What the installer reads from a Linux machine; injected so the checks run on any platform. */
export type LinuxHost = {
  /** A small text file, or undefined when it cannot be read. */
  read(file: string): string | undefined;
  exists(file: string): boolean;
  list(dir: string): string[];
  /** The first bytes of a file as latin1: an AppImage starts with its own runtime. */
  head(file: string, bytes: number): string;
};

export const linuxHost: LinuxHost = {
  read: (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  },
  exists: (file) => fs.existsSync(file),
  list: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  head: (file, bytes) => {
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, "r");
      const buffer = Buffer.alloc(bytes);
      return buffer.subarray(0, fs.readSync(fd, buffer, 0, bytes, 0)).toString("latin1");
    } catch {
      return "";
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  },
};

/** What an AppImage needs to mount itself and this machine lacks. */
export type MountBlock = { device: boolean; helper: boolean; library: boolean };

const RUNTIME_BYTES = 256 * 1024;
const BIN_DIRS = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const LIB_DIRS = ["/lib", "/lib64", "/usr/lib", "/usr/lib64", "/usr/local/lib"].flatMap((dir) => [
  dir,
  `${dir}/x86_64-linux-gnu`,
  `${dir}/aarch64-linux-gnu`,
]);

/** Why this AppImage cannot mount itself here, or undefined when it can. Paths are POSIX whatever runs the check. */
export function mountBlock(host: LinuxHost, appImage: string, env: NodeJS.ProcessEnv): MountBlock | undefined {
  const dirs = [...(env.PATH ?? "").split(":").filter(Boolean), ...BIN_DIRS];
  const has = (name: string) => dirs.some((dir) => host.exists(`${dir}/${name}`));
  // The runtime electron-builder ships loads libfuse 2 at start; a static one carries its own and only needs a helper.
  const classic = host.head(appImage, RUNTIME_BYTES).includes("libfuse.so.2");
  const block: MountBlock = {
    device: !host.exists("/dev/fuse"),
    helper: classic ? !has("fusermount") : !has("fusermount3") && !has("fusermount"),
    library: classic && !LIB_DIRS.some((dir) => host.list(dir).some((file) => file.startsWith("libfuse.so.2"))),
  };
  return block.device || block.helper || block.library ? block : undefined;
}

/** The one command that lets AppImages mount on this distribution (from /etc/os-release); none when packages cannot fix it. */
export function fuseCommand(osRelease: string | undefined, block: MountBlock): string | undefined {
  if (!block.helper && !block.library) return undefined;
  const field = (name: string) => new RegExp(`^${name}=["']?([^"'\\n]*)`, "m").exec(osRelease ?? "")?.[1] ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.toLowerCase().split(/\s+/);
  const is = (...names: string[]) => names.some((name) => ids.includes(name));
  const pick = (library: string, helper: string) =>
    [block.library ? library : "", block.helper ? helper : ""].filter(Boolean).join(" ");
  if (is("debian", "ubuntu")) {
    // Never the package "fuse": on Ubuntu it replaces fuse3 and takes the desktop with it. Ubuntu 24.04 renamed the library.
    if (!block.library) return "sudo apt install fuse3";
    return `sudo apt install ${pick("libfuse2t64", "fuse3")} || sudo apt install ${pick("libfuse2", "fuse3")}`;
  }
  if (is("fedora", "rhel", "centos")) return `sudo dnf install ${pick("fuse-libs", "fuse")}`;
  if (is("arch")) return "sudo pacman -S fuse2";
  if (is("suse", "opensuse")) return `sudo zypper install ${pick("libfuse2", "fuse")}`;
  return undefined;
}

export type LaunchFailure = "mount" | "sandbox" | "root" | "library" | "display";

/** What stopped the app, from what it printed: the exit code says nothing (no FUSE and a crash both give 1). */
export function launchFailure(output: string): LaunchFailure | undefined {
  if (/libfuse\.so\.2|AppImages require FUSE|fusermount|Cannot mount AppImage|\/dev\/fuse/i.test(output))
    return "mount";
  if (/Running as root without --no-sandbox/i.test(output)) return "root";
  if (/SUID sandbox helper binary|No usable sandbox|setuid_sandbox_host/i.test(output)) return "sandbox";
  if (/error while loading shared libraries/i.test(output)) return "library";
  if (
    /Missing X server or \$DISPLAY|cannot open display|Failed to connect to Wayland|platform failed to initialize/i.test(
      output,
    )
  )
    return "display";
  return undefined;
}

export const LINUX_HELP = "https://colonia.ingenierobinario.com/start/install/#linux";

/** Said once when Colonia runs unpacked because the AppImage cannot mount itself. */
export function unpackedNote(command: string | undefined): string {
  const how = command
    ? `To make it start faster, run this once:\n  ${command}`
    : "This system has no FUSE device, so it stays that way.";
  return `Colonia opens by unpacking itself each time, because this system cannot mount AppImages. ${how}`;
}

/** The failure in words a person can act on. The sandbox is never turned off to get past it. */
export function failureMessage(output: string, command: string | undefined): string {
  const kind = launchFailure(output);
  const last = output.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim().slice(0, 300) ?? "";
  if (kind === "mount")
    return `Colonia is installed, but this system cannot mount AppImages.${command ? ` Run this once, then open Colonia again:\n  ${command}` : ` See ${LINUX_HELP}`}`;
  if (kind === "root") return "Colonia is installed, but its window does not run as root. Open it as a regular user.";
  if (kind === "sandbox")
    return `Colonia is installed, but this system stops the sandbox its window runs in. Colonia does not open without it; the one command that allows it is at ${LINUX_HELP}`;
  if (kind === "library") {
    const lib = /loading shared libraries: (\S+?):/.exec(output)?.[1];
    return `Colonia is installed, but a system library it needs is missing${lib ? ` (${lib})` : ""}. Install it with your package manager, then open Colonia again. See ${LINUX_HELP}`;
  }
  if (kind === "display")
    return "Colonia is installed, but it found no screen to open on. Open it from the desktop session.";
  return last ? `Colonia did not start. It said: ${last}` : "Colonia did not start and said nothing about why.";
}
