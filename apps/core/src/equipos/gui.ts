// EQUIPO-GUI-1 · Abrir una aplicación o un archivo en el escritorio que el usuario del equipo tiene delante.
//
// Una orden que llega por terminal remota (SSH) a Windows corre en una sesión sin escritorio: `calc` termina con código 0
// y la ventana no la ve nadie. Aquí se construye, para cada sistema, la orden que la lleva a la sesión de quien tiene
// la sesión iniciada, dice claro cuándo no hay nadie y comprueba al acabar que lo abierto sigue vivo:
//   - Windows: una tarea programada de un solo uso, con inicio de sesión interactivo del usuario conectado; se lanza,
//     se espera su resultado y se borra siempre.
//   - macOS: `open` (con `launchctl asuser` si la sesión gráfica es de otro usuario).
//   - Linux: con DISPLAY / WAYLAND_DISPLAY / DBUS de un proceso de la sesión gráfica del usuario.
// La orden se ejecuta por el mismo camino que equipo_run (terminal remota o equipo emparejado): no abre otro.
import { psEncoded, type RemoteOs, shQuote } from "./ssh.ts";

export const GUI_TARGET_MAX = 300;
export const GUI_ARGS_MAX = 200;
/** Lo que admite `equipos.run` (y cmd.exe se queda en 8191): la orden de Windows tiene que caber. */
export const GUI_COMMAND_MAX = 8000;
/** Margen para la espera de la tarea (15 s), la comprobación (2 s) y la conexión. */
export const GUI_TIMEOUT_S = 60;

export type GuiOpen = { target: string; args?: readonly string[] };

export const guiOs = (platform: string): RemoteOs =>
  platform === "win32" || platform === "windows"
    ? "windows"
    : platform === "darwin" || platform === "macos"
      ? "macos"
      : platform === "linux"
        ? "linux"
        : "other";

/** Literal de PowerShell. Sus comillas tipográficas también cierran una cadena simple: se doblan igual. */
export const psQuote = (s: string) => `'${s.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")}'`;

/** Un argumento como lo espera un programa de Windows: entre comillas si lleva espacios, con las suyas escapadas. */
export function winArg(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** El script de PowerShell, legible; viaja en base64 (ver guiOpenCommand). `id` hace únicos la tarea y su resultado. */
export function windowsGuiScript(o: GuiOpen, id: string): string {
  const args = (o.args ?? []).map(winArg).join(" ");
  return [
    `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'`,
    `$T=${psQuote(o.target)};$A=${psQuote(args)};$N='ColoniaAbrir-${id}';$O=Join-Path $env:PUBLIC 'colonia-gui-${id}.txt'`,
    `try{`,
    `$me=[Security.Principal.WindowsIdentity]::GetCurrent().Name`,
    // Quién tiene escritorio: un explorer.exe fuera de la sesión 0. Sin ninguno, no hay nadie con la sesión iniciada.
    `$ex=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|?{$_.SessionId -ne 0})`,
    `if(!$ex){'COLONIA_GUI NO_SESSION';exit 3}`,
    `$ss=@($ex|%{$u='';try{$o=Invoke-CimMethod -InputObject $_ -MethodName GetOwner;if($o.User){$u="$($o.Domain)\\$($o.User)"}}catch{};[pscustomobject]@{S=$_.SessionId;U=$u}}|?{$_.U})`,
    `if(!$ss){'COLONIA_GUI OTHER_USER';exit 3}`,
    `$k=@($ss|?{$_.U -ieq $me})[0];if(!$k){$k=$ss[0]}`,
    `$L=[bool](Get-Process LogonUI -ErrorAction SilentlyContinue|?{$_.SessionId -eq $k.S})`,
    // Lo que corre dentro de la sesión del usuario: abre como lo haría un doble clic y deja escrito el resultado.
    `$q={param($s)"'"+$s.Replace("'","''")+"'"}`,
    `$in="\`$ErrorActionPreference='Stop';try{\`$p=Start-Process -FilePath "+(&$q $T)+$(if($A){" -ArgumentList "+(&$q $A)})+" -PassThru;Set-Content -LiteralPath "+(&$q $O)+" -Value ('OK '+\`$p.Id)}catch{Set-Content -LiteralPath "+(&$q $O)+" -Value ('ERR '+\`$_.Exception.Message)}"`,
    `$b=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($in))`,
    `$t0=Get-Date`,
    `try{`,
    `Register-ScheduledTask -TaskName $N -Force -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $b") -Principal (New-ScheduledTaskPrincipal -UserId $k.U -LogonType Interactive) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)|Out-Null`,
    `Start-ScheduledTask -TaskName $N`,
    `for($i=0;$i -lt 60 -and !(Test-Path -LiteralPath $O);$i++){Start-Sleep -Milliseconds 250}`,
    `}finally{Unregister-ScheduledTask -TaskName $N -Confirm:$false -ErrorAction SilentlyContinue}`,
    `if(!(Test-Path -LiteralPath $O)){'COLONIA_GUI NOT_STARTED';exit 4}`,
    `$r=(Get-Content -LiteralPath $O -Raw).Trim();Remove-Item -LiteralPath $O -Force -ErrorAction SilentlyContinue`,
    `if($r -like 'ERR*'){'COLONIA_GUI LAUNCH_ERROR '+$r.Substring(3).Trim();exit 5}`,
    // ¿Sigue vivo? El lanzador puede salir enseguida (calc.exe arranca la Calculadora y termina): cuentan también los
    // procesos nacidos en esa sesión desde el lanzamiento.
    `Start-Sleep -Seconds 2`,
    `$id=0;[void][int]::TryParse(($r -replace '^OK\\s*',''),[ref]$id)`,
    `$al=[bool]($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue))`,
    `$nw=@(Get-Process|?{$_.SessionId -eq $k.S -and @('powershell','conhost') -notcontains $_.ProcessName}|?{try{$_.StartTime -ge $t0}catch{$false}}|%{$_.ProcessName}|Select-Object -Unique -First 8)`,
    `"COLONIA_GUI OK user=$($k.U) locked=$L pid=$id alive=$al new=$($nw -join ',')"`,
    `}catch{'COLONIA_GUI ERROR '+$_.Exception.Message;exit 6}`,
  ].join("\n");
}

/** macOS: el dueño de /dev/console es quien tiene la sesión gráfica; en la pantalla de inicio de sesión es root. */
export const MAC_SESSION: readonly string[] = [
  `u=$(stat -f%Su /dev/console 2>/dev/null)`,
  `if [ -z "$u" ] || [ "$u" = root ] || [ "$u" = loginwindow ]; then echo 'COLONIA_GUI NO_SESSION'; exit 3; fi`,
  `uid=$(id -u "$u"); me=$(id -u)`,
];

/** Linux: entra en la sesión gráfica del usuario (su pantalla y su DBUS) o dice que no hay ninguna. */
export const LINUX_SESSION: readonly string[] = [
  // La sesión gráfica se reconoce por un proceso del usuario que tenga pantalla en su entorno.
  `me=$(id -u); f=''`,
  `for p in $(pgrep -u "$me" 2>/dev/null); do if tr '\\0' '\\n' < "/proc/$p/environ" 2>/dev/null | grep -Eq '^(WAYLAND_DISPLAY|DISPLAY)=.'; then f=$p; break; fi; done`,
  `if [ -z "$f" ]; then`,
  `  o=$(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}' | while read -r s; do i=$(loginctl show-session "$s" -p Type -p Class 2>/dev/null | tr '\\n' ' '); case "$i" in *Class=user*) case "$i" in *Type=x11*|*Type=wayland*) loginctl show-session "$s" -p Name --value 2>/dev/null;; esac;; esac; done | sort -u | tr '\\n' ' ')`,
  `  if [ -n "$o" ]; then echo "COLONIA_GUI OTHER_USER $o"; else echo 'COLONIA_GUI NO_SESSION'; fi; exit 3`,
  `fi`,
  `for k in DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR XDG_CURRENT_DESKTOP XDG_SESSION_TYPE; do v=$(tr '\\0' '\\n' < "/proc/$f/environ" 2>/dev/null | sed -n "s/^$k=//p" | head -n 1); if [ -n "$v" ]; then export "$k=$v"; fi; done`,
  `if [ -z "$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "/run/user/$me/bus" ]; then export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$me/bus"; fi`,
];

export function macGuiScript(o: GuiOpen): string {
  const args = (o.args ?? []).map(shQuote).join(" ");
  return [
    `T=${shQuote(o.target)}`,
    ...MAC_SESSION,
    `app=''`,
    `if [ -e "$T" ]; then set -- "$T"; else case "$T" in *://*) set -- "$T";; *) app=1; set -- -a "$T";; esac; fi`,
    ...(args ? [`set -- "$@" --args ${args}`] : []),
    `if [ "$uid" = "$me" ]; then e=$(open "$@" 2>&1); c=$?; else e=$(sudo -n launchctl asuser "$uid" sudo -n -u "$u" open "$@" 2>&1); c=$?; fi`,
    `if [ $c -ne 0 ]; then`,
    `  if [ "$uid" != "$me" ]; then case "$e" in *sudo*|*password*) echo "COLONIA_GUI OTHER_USER $u"; exit 3;; esac; fi`,
    `  echo "COLONIA_GUI LAUNCH_ERROR $(printf %s "$e" | tr '\\n' ' ')"; exit 5`,
    `fi`,
    `sleep 2; al=unknown`,
    `if [ -n "$app" ]; then if pgrep -u "$uid" -if -- "$T" >/dev/null 2>&1; then al=True; else al=False; fi; fi`,
    `echo "COLONIA_GUI OK user=$u locked=unknown pid=0 alive=$al new="`,
  ].join("\n");
}

export function linuxGuiScript(o: GuiOpen): string {
  const args = (o.args ?? []).map(shQuote).join(" ");
  return [
    `T=${shQuote(o.target)}`,
    ...LINUX_SESSION,
    `al=unknown; pid=0`,
    `if [ ! -d "$T" ] && command -v "$T" >/dev/null 2>&1; then`,
    `  S=$(command -v setsid 2>/dev/null)`,
    `  $S nohup "$T" ${args} >/dev/null 2>&1 &`,
    `  pid=$!; sleep 2; if kill -0 "$pid" 2>/dev/null; then al=True; else al=False; fi`,
    `else`,
    `  url=''; case "$T" in *://*) url=1;; esac`,
    `  if [ -e "$T" ] || [ -n "$url" ]; then e=$( (xdg-open "$T" || gio open "$T") 2>&1); c=$?; else e=$(gtk-launch "$T" 2>&1); c=$?; fi`,
    `  if [ $c -ne 0 ]; then echo "COLONIA_GUI LAUNCH_ERROR $(printf %s "$e" | tr '\\n' ' ')"; exit 5; fi`,
    `fi`,
    `echo "COLONIA_GUI OK user=$(id -un) locked=unknown pid=$pid alive=$al new="`,
  ].join("\n");
}

/** La orden completa para `equipos.run`. Lanza si el sistema del equipo no se conoce o si no cabe. */
export function guiOpenCommand(os_: RemoteOs, o: GuiOpen, id: string): string {
  if (!/^[a-z0-9]{4,32}$/i.test(id)) throw new Error("identificador de lanzamiento no válido");
  if (!o.target.trim() || o.target.length > GUI_TARGET_MAX) throw new Error("what to open is empty or too long");
  if ((o.args ?? []).join(" ").length > GUI_ARGS_MAX) throw new Error("the arguments are too long");
  if (/[\0\r\n]/.test([o.target, ...(o.args ?? [])].join(""))) throw new Error("no line breaks in what to open");
  const cmd =
    os_ === "windows"
      ? psEncoded(windowsGuiScript(o, id))
      : os_ === "macos"
        ? macGuiScript(o)
        : os_ === "linux"
          ? linuxGuiScript(o)
          : undefined;
  if (!cmd) throw new Error("that computer's system is not known, so a window cannot be opened on its desktop");
  if (cmd.length > GUI_COMMAND_MAX) throw new Error("what to open and its arguments are too long");
  return cmd;
}

export type GuiResult =
  | { state: "opened"; user: string; locked: boolean; alive: boolean | undefined; started: string[] }
  | { state: "no_session" }
  | { state: "other_user"; who: string }
  | { state: "not_started" }
  | { state: "error"; detail: string };

/** Lo que contestó el equipo, leído de su línea `COLONIA_GUI …`. Sin esa línea, el fallo es lo que haya salido. */
export function parseGuiResult(output: string): GuiResult {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .findLast((l) => l.startsWith("COLONIA_GUI "));
  if (!line) return { state: "error", detail: output.trim().slice(0, 600) || "the computer answered nothing" };
  const rest = line.slice("COLONIA_GUI ".length);
  if (rest.startsWith("NO_SESSION")) return { state: "no_session" };
  if (rest.startsWith("OTHER_USER")) return { state: "other_user", who: rest.slice("OTHER_USER".length).trim() };
  if (rest.startsWith("NOT_STARTED")) return { state: "not_started" };
  const ok = /^OK user=(.*) locked=(\S+) pid=(\d+) alive=(\S+) new=(.*)$/.exec(rest);
  if (!ok) return { state: "error", detail: rest.replace(/^(LAUNCH_ERROR|ERROR)\s*/, "").slice(0, 600) };
  const started = (ok[5] ?? "").split(",").filter(Boolean);
  const alive = ok[4] === "True" ? true : ok[4] === "False" ? started.length > 0 : undefined;
  return { state: "opened", user: ok[1] ?? "", locked: ok[2] === "True", alive, started };
}
