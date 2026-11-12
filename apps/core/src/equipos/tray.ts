// Icono persistente en la bandeja mientras haya una sesión de agente activa en este equipo.
// Solo Windows (NotifyIcon de .NET en un PowerShell oculto que vive lo que dure la sesión). En macOS y Linux no hay
// una forma portable sin una dependencia nativa: ahí queda la notificación del sistema (notify.ts) y se declara.
import { type ChildProcess, spawn } from "node:child_process";

export type Tray = { show(text: string): void; hide(): void; supported: boolean };

const WINDOWS = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
  "$n=New-Object System.Windows.Forms.NotifyIcon;",
  "$n.Icon=[System.Drawing.SystemIcons]::Shield;$n.Text=$env:COLONIA_AVISO_TEXTO;$n.Visible=$true;",
  "[System.Windows.Forms.Application]::Run()",
].join("");

export const noTray: Tray = { show() {}, hide() {}, supported: false };

export function systemTray(platform: NodeJS.Platform = process.platform): Tray {
  if (platform !== "win32") return noTray;
  let child: ChildProcess | undefined;
  return {
    supported: true,
    show(text) {
      if (child) return;
      try {
        child = spawn(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS],
          {
            env: { ...process.env, COLONIA_AVISO_TEXTO: text.slice(0, 60) },
            stdio: "ignore",
            windowsHide: true,
          },
        );
        child.on("error", () => {});
        child.on("exit", () => (child = undefined));
      } catch {
        child = undefined;
      }
    },
    hide() {
      const c = child;
      child = undefined;
      try {
        c?.kill();
      } catch {}
    },
  };
}
