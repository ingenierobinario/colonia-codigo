// Confirmar que quien mira una contraseña guardada es el dueño del equipo. Windows: Windows Hello (o su PIN) con
// UserConsentVerifier; macOS: Touch ID o contraseña del Mac. Si el sistema no puede preguntar, un aviso propio de
// Colonia (no prueba identidad: se declara así en la lista). Nada de esto toca la contraseña.
import { execFile } from "node:child_process";
import { app, type BaseWindow, dialog, systemPreferences } from "electron";

export type Texto = { motivo: string; titulo: string; aceptar: string; cancelar: string };

const HELLO = (motivo: string) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Esperar($op, $tipo) { $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); $t.Wait(); $t.Result }
$disp = Esperar ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($disp -ne 'Available') { Write-Output 'NoDisponible'; exit 0 }
Write-Output (Esperar ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${motivo.replace(/'/g, "''")}')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult]))
`;

/** "ok" | "no" | "sin-sistema": con "sin-sistema" quien llama decide si cae al aviso propio. */
function windowsHello(motivo: string): Promise<"ok" | "no" | "sin-sistema"> {
  return new Promise((resolve) => {
    const cmd = Buffer.from(HELLO(motivo), "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", cmd],
      { timeout: 90_000, windowsHide: true },
      (err, out) => {
        const r = String(out).trim();
        if (err || !r) return resolve("sin-sistema");
        if (r === "Verified") return resolve("ok");
        resolve(r === "NoDisponible" ? "sin-sistema" : "no");
      },
    );
  });
}

export async function confirmarDueno(win: BaseWindow | undefined, t: Texto): Promise<boolean> {
  if (process.platform === "darwin" && systemPreferences.canPromptTouchID()) {
    return systemPreferences.promptTouchID(t.motivo).then(
      () => true,
      () => false,
    );
  }
  if (process.platform === "win32") {
    const r = await windowsHello(t.motivo);
    if (r !== "sin-sistema") return r === "ok";
  }
  const opts = {
    type: "warning" as const,
    title: app.name,
    message: t.titulo,
    detail: t.motivo,
    buttons: [t.aceptar, t.cancelar],
    defaultId: 1,
    cancelId: 1,
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return response === 0;
}
