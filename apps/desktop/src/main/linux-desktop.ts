// What a Linux desktop may lack: a tray, the sandbox, global shortcuts. Each answer is worked out from injected
// readings, so the rules are tested on any platform.
import { execFile } from "node:child_process";

export type Probe = (command: string, args: string[]) => Promise<{ ok: boolean; missing: boolean; out: string }>;

export const probe: Probe = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 2000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({
        ok: !error,
        missing: (error as NodeJS.ErrnoException | null)?.code === "ENOENT",
        out: `${stdout}${stderr}`,
      }),
    );
  });

const WATCHER = [
  "call",
  "--session",
  "--dest",
  "org.kde.StatusNotifierWatcher",
  "--object-path",
  "/StatusNotifierWatcher",
  "--method",
  "org.freedesktop.DBus.Properties.Get",
  "org.kde.StatusNotifierWatcher",
  "IsStatusNotifierHostRegistered",
];

/** Whether this desktop shows tray icons. GNOME shows none without an extension, and a hidden window is then lost. */
export async function hasTrayHost(platform: string, env: NodeJS.ProcessEnv, run: Probe = probe): Promise<boolean> {
  if (platform !== "linux") return true;
  const answer = await run("gdbus", WATCHER);
  if (answer.ok) return /\btrue\b/.test(answer.out);
  // Nobody answers for tray icons. Outside GNOME an X11 panel may still show the older kind; Wayland has only this one.
  const gnome = /gnome|unity/i.test(env.XDG_CURRENT_DESKTOP ?? "");
  if (answer.missing) return !gnome;
  return !gnome && env.XDG_SESSION_TYPE !== "wayland" && !env.WAYLAND_DISPLAY;
}

export type SandboxNotice = {
  /** `namespaces`: the system forbids what the sandbox needs. `switch`: something opened Colonia with the switch. */
  reason: "namespaces" | "switch";
  /** The one command that lets the sandbox work, when there is one. */
  command?: string;
};

const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/**
 * Colonia running without its sandbox, and the way out. The AppImage launcher drops the sandbox by itself when the
 * system forbids unprivileged user namespaces, so this is how the owner gets to know.
 */
export function sandboxNotice(o: {
  platform: string;
  argv: readonly string[];
  appImage?: string | undefined;
  read: (file: string) => string | undefined;
  exists: (file: string) => boolean;
}): SandboxNotice | undefined {
  if (o.platform !== "linux" || !o.argv.includes("--no-sandbox")) return undefined;
  const value = (file: string) => o.read(file)?.trim();
  if (value("/proc/sys/kernel/unprivileged_userns_clone") === "0")
    return { reason: "namespaces", command: "sudo sysctl -w kernel.unprivileged_userns_clone=1" };
  if (value("/proc/sys/user/max_user_namespaces") === "0")
    return { reason: "namespaces", command: "sudo sysctl -w user.max_user_namespaces=15000" };
  if (value("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") === "1") {
    if (!o.appImage) return { reason: "namespaces" };
    // AppArmor reads the path as a pattern: its special characters are escaped, then the whole line is quoted for sh.
    const target = o.appImage.replace(/[\\*?[\]{}^"]/g, "\\$&");
    const profile = [
      ...(o.exists("/etc/apparmor.d/abi/4.0") ? ["abi <abi/4.0>,"] : []),
      "include <tunables/global>",
      `profile colonia-desktop "${target}" flags=(unconfined) {`,
      "  userns,",
      "}",
    ];
    return {
      reason: "namespaces",
      command: `printf '%s\\n' ${profile.map(quote).join(" ")} | sudo tee /etc/apparmor.d/colonia-desktop >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/colonia-desktop`,
    };
  }
  return { reason: "switch" };
}

export function sandboxText(notice: SandboxNotice, es: boolean): { message: string; detail: string } {
  const message = es ? "Colonia está funcionando sin su aislamiento" : "Colonia is running without its sandbox";
  if (notice.reason === "switch")
    return {
      message,
      detail: es
        ? "Algo abrió Colonia con la opción --no-sandbox (suele ser una entrada del menú creada por otra herramienta). Las páginas que abren los agentes quedan menos aisladas del resto del equipo. Ábrela sin esa opción para recuperar el aislamiento."
        : "Something opened Colonia with the --no-sandbox option (usually a menu entry made by another tool). Pages your agents open are less isolated from the rest of the computer. Open it without that option to get the sandbox back.",
    };
  const why = es
    ? "Este sistema no deja que las aplicaciones creen el aislamiento que usa Colonia, así que se abrió sin él. Las páginas que abren los agentes quedan menos aisladas del resto del equipo."
    : "This system does not let apps create the sandbox Colonia uses, so it opened without it. Pages your agents open are less isolated from the rest of the computer.";
  const fix = notice.command
    ? es
      ? "Para permitirlo, ejecuta esta orden una vez en una terminal y vuelve a abrir Colonia:"
      : "To allow it, run this command once in a terminal and open Colonia again:"
    : es
      ? "La guía de instalación explica cómo permitirlo."
      : "The install guide explains how to allow it.";
  return { message, detail: `${why}\n\n${fix}${notice.command ? `\n\n${notice.command}` : ""}` };
}

/** Why a global shortcut that would not register failed: Wayland lends none to apps, which is not "taken". */
export function shortcutRefused(shortcut: string, platform: string, env: NodeJS.ProcessEnv, es: boolean): string {
  if (platform === "linux" && (env.XDG_SESSION_TYPE === "wayland" || env.WAYLAND_DISPLAY))
    return es
      ? `Este escritorio (Wayland) no deja que las aplicaciones reserven atajos globales. Asigna ${shortcut} a Colonia desde los ajustes de teclado del sistema, o ábrela desde el menú.`
      : `This desktop (Wayland) does not let apps claim global shortcuts. Bind ${shortcut} to Colonia in the system keyboard settings, or open it from the menu.`;
  return es ? `el atajo ${shortcut} lo usa otra aplicación` : `the shortcut ${shortcut} is taken by another app`;
}

/** What a Linux login runs. An AppImage that had to unpack itself to start needs the same at login. */
export function loginCommand(executable: string, env: NodeJS.ProcessEnv): string {
  const quoted = `"${executable.replace(/%/g, "%%").replace(/[\\"`$]/g, "\\$&")}"`;
  return env.APPIMAGE_EXTRACT_AND_RUN ? `env APPIMAGE_EXTRACT_AND_RUN=1 ${quoted}` : quoted;
}
