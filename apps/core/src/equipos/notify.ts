// Aviso visible en el equipo cuando alguien pide o usa su acceso: una notificación del sistema. El texto viaja por
// variables de entorno del proceso hijo, nunca dentro del comando, para que ningún contenido ajeno se ejecute.
import { spawn } from "node:child_process";

export type Notify = (title: string, body: string) => void;

const WINDOWS = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
  "$n=New-Object System.Windows.Forms.NotifyIcon;",
  "$n.Icon=[System.Drawing.SystemIcons]::Shield;$n.Visible=$true;",
  "$n.ShowBalloonTip(10000,$env:COLONIA_AVISO_TITULO,$env:COLONIA_AVISO_TEXTO,'Info');",
  "Start-Sleep -Seconds 11;$n.Dispose()",
].join("");

export function systemNotify(platform: NodeJS.Platform = process.platform): Notify {
  return (title, body) => {
    const env = { ...process.env, COLONIA_AVISO_TITULO: title, COLONIA_AVISO_TEXTO: body.slice(0, 250) };
    const [cmd, args]: [string, string[]] =
      platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS]]
        : platform === "darwin"
          ? [
              "osascript",
              [
                "-e",
                'display notification (system attribute "COLONIA_AVISO_TEXTO") with title (system attribute "COLONIA_AVISO_TITULO")',
              ],
            ]
          : ["notify-send", [title, body.slice(0, 250)]];
    try {
      const child = spawn(cmd, args, { env, stdio: "ignore", detached: true, windowsHide: true });
      child.on("error", () => {});
      child.unref();
    } catch {}
  };
}
