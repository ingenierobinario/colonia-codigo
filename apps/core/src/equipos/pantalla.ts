// EQUIPO-GUI-1 · Ver y manejar la pantalla de un equipo conectado: una captura de lo que su usuario tiene delante y
// clics, teclas y texto sobre ello. Usa el mismo camino que equipo_open (gui.ts) para entrar en la sesión con
// escritorio, y dice exactamente qué falta cuando no puede (nadie con la sesión iniciada, pantalla bloqueada, un permiso
// de macOS, un programa que no está en Linux):
//   - Windows: una tarea programada de un solo uso en la sesión del usuario. Lo que corre allí (System.Drawing para la
//     captura, SendInput para el ratón y el teclado) viaja como archivo, no en la orden: así no choca con su tope.
//   - macOS: screencapture + sips, y osascript para el ratón (CoreGraphics) y el teclado (System Events).
//   - Linux: grim / gnome-screenshot / spectacle / scrot / maim / import, y xdotool o ydotool.
// La imagen vuelve por la lectura de archivos del equipo (no por la salida de la orden) y se borra de allí.
import { GUI_COMMAND_MAX, LINUX_SESSION, MAC_SESSION, psQuote } from "./gui.ts";
import { psEncoded, type RemoteOs, shQuote } from "./ssh.ts";

/** El lado mayor de la captura, el mismo que usan las capturas de la pantalla local (apps/desktop: SHOT_MAX). */
export const SCREEN_SHOT_MAX = 1600;
export const SCREEN_STEPS_MAX = 12;
export const SCREEN_TEXT_MAX = 2000;
/** La tarea de Windows espera hasta 40 s (compilar el ayudante, teclear un texto largo); el resto es conexión. */
export const SCREEN_TIMEOUT_S = 90;

export type ScreenStep =
  | { do: "click"; x: number; y: number }
  | { do: "key"; keys: string }
  | { do: "type"; text: string };

const checkId = (id: string) => {
  if (!/^[a-z0-9]{4,32}$/i.test(id)) throw new Error("identificador de lanzamiento no válido");
};
/** Los archivos que deja una operación en el equipo, en la carpeta donde arranca su terminal: se nombran sin ruta. */
export const screenFiles = (id: string) => ({
  script: `colonia-gui-${id}.ps1`,
  jpg: `colonia-gui-${id}.jpg`,
  png: `colonia-gui-${id}.png`,
});

// ── Teclas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Key = {
  /** Windows: tecla virtual. */ vk: number;
  /** macOS: código de tecla de System Events, o el carácter para `keystroke`. */ mac: number | string;
  /** xdotool. */ x: string;
  /** ydotool: código de evdev. */ ev: number;
};
type Mod = Key & { /** macOS: `command down`… */ using: string };

const MODS: Record<string, Mod> = {
  ctrl: { vk: 17, mac: 59, x: "ctrl", ev: 29, using: "control down" },
  shift: { vk: 16, mac: 56, x: "shift", ev: 42, using: "shift down" },
  alt: { vk: 18, mac: 58, x: "alt", ev: 56, using: "option down" },
  cmd: { vk: 91, mac: 55, x: "super", ev: 125, using: "command down" },
};
const MOD_ALIASES: Record<string, string> = {
  control: "ctrl",
  option: "alt",
  opt: "alt",
  command: "cmd",
  win: "cmd",
  windows: "cmd",
  meta: "cmd",
  super: "cmd",
};
const NAMED: Record<string, Key> = {
  enter: { vk: 13, mac: 36, x: "Return", ev: 28 },
  tab: { vk: 9, mac: 48, x: "Tab", ev: 15 },
  esc: { vk: 27, mac: 53, x: "Escape", ev: 1 },
  space: { vk: 32, mac: 49, x: "space", ev: 57 },
  backspace: { vk: 8, mac: 51, x: "BackSpace", ev: 14 },
  delete: { vk: 46, mac: 117, x: "Delete", ev: 111 },
  up: { vk: 38, mac: 126, x: "Up", ev: 103 },
  down: { vk: 40, mac: 125, x: "Down", ev: 108 },
  left: { vk: 37, mac: 123, x: "Left", ev: 105 },
  right: { vk: 39, mac: 124, x: "Right", ev: 106 },
  home: { vk: 36, mac: 115, x: "Home", ev: 102 },
  end: { vk: 35, mac: 119, x: "End", ev: 107 },
  pageup: { vk: 33, mac: 116, x: "Page_Up", ev: 104 },
  pagedown: { vk: 34, mac: 121, x: "Page_Down", ev: 109 },
};
const KEY_ALIASES: Record<string, string> = {
  return: "enter",
  escape: "esc",
  del: "delete",
  pgup: "pageup",
  pgdn: "pagedown",
};
const MAC_F = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111];
const EV_F = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88];
const EV_ROWS: [string, number][] = [
  ["1234567890", 2],
  ["qwertyuiop", 16],
  ["asdfghjkl", 30],
  ["zxcvbnm", 44],
];

/** "ctrl+l", "enter", "cmd+shift+t": modificadores y una tecla, como en screen_do. Lanza si no la conoce. */
export function parseKeys(keys: string): { mods: Mod[]; key: Key } {
  const parts = keys
    .toLowerCase()
    .split("+")
    .map((p) => p.trim());
  const last = parts.pop() ?? "";
  const mods = parts.map((p) => {
    const m = MODS[MOD_ALIASES[p] ?? p];
    if (!m) throw new Error(`unknown modifier "${p}" in "${keys}" (use ctrl, shift, alt, cmd)`);
    return m;
  });
  const name = KEY_ALIASES[last] ?? last;
  const named = NAMED[name];
  if (named) return { mods, key: named };
  const f = /^f([1-9]|1[0-2])$/.exec(name);
  if (f) {
    const n = Number(f[1]);
    return { mods, key: { vk: 111 + n, mac: MAC_F[n - 1] ?? 0, x: `F${n}`, ev: EV_F[n - 1] ?? 0 } };
  }
  if (/^[a-z0-9]$/.test(name)) {
    const row = EV_ROWS.find(([chars]) => chars.includes(name));
    return {
      mods,
      key: { vk: name.toUpperCase().charCodeAt(0), mac: name, x: name, ev: row ? row[1] + row[0].indexOf(name) : 0 },
    };
  }
  throw new Error(
    `unknown key "${last}" in "${keys}" (enter, tab, esc, space, backspace, delete, arrows, home, end, pageup, pagedown, f1-f12, a letter or a digit)`,
  );
}

function checkSteps(steps: readonly ScreenStep[]) {
  if (!steps.length || steps.length > SCREEN_STEPS_MAX) throw new Error(`between 1 and ${SCREEN_STEPS_MAX} steps`);
  for (const st of steps) {
    if (st.do === "click") {
      if (!Number.isInteger(st.x) || !Number.isInteger(st.y) || Math.abs(st.x) > 20_000 || Math.abs(st.y) > 20_000)
        throw new Error("a click needs whole x and y on the screen");
    } else if (st.do === "key") parseKeys(st.keys);
    else if (!st.text || st.text.length > SCREEN_TEXT_MAX || st.text.includes("\0"))
      throw new Error("the text to type is empty or too long");
  }
}

// ── Windows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Corre DENTRO de la sesión del usuario: guarda la captura (JPEG, lado mayor acotado) y deja escrito su tamaño. */
export function windowsShotInner(id: string): string {
  checkId(id);
  return [
    `$ErrorActionPreference='Stop';$O=Join-Path $env:PUBLIC 'colonia-gui-${id}.txt';$I=Join-Path $env:PUBLIC 'colonia-gui-${id}.jpg'`,
    `try{`,
    `Add-Type -AssemblyName System.Drawing,System.Windows.Forms`,
    // Sin esto, con la pantalla escalada (125 %, 150 %) la captura saldría recortada y los puntos no casarían.
    `Add-Type -Namespace Colonia -Name Dpi -MemberDefinition '[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();'`,
    `[void][Colonia.Dpi]::SetProcessDPIAware()`,
    `$b=[Windows.Forms.SystemInformation]::VirtualScreen`,
    `$bmp=New-Object Drawing.Bitmap $b.Width,$b.Height`,
    `$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size);$g.Dispose()`,
    `$k=[Math]::Min(1.0,${SCREEN_SHOT_MAX}/[Math]::Max($b.Width,$b.Height))`,
    `$w=[int][Math]::Round($b.Width*$k);$h=[int][Math]::Round($b.Height*$k)`,
    `$bm=New-Object Drawing.Bitmap $w,$h;$g=[Drawing.Graphics]::FromImage($bm);$g.InterpolationMode='HighQualityBicubic';$g.DrawImage($bmp,0,0,$w,$h);$g.Dispose()`,
    `$c=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{$_.MimeType -eq 'image/jpeg'}`,
    `$p=New-Object Drawing.Imaging.EncoderParameters 1;$p.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),([long]70)`,
    `$bm.Save($I,$c,$p);$bm.Dispose();$bmp.Dispose()`,
    `Set-Content -LiteralPath $O -Value "SHOT x=$($b.X) y=$($b.Y) sw=$($b.Width) sh=$($b.Height)"`,
    `}catch{Set-Content -LiteralPath $O -Value ('ERR '+$_.Exception.Message)}`,
  ].join("\n");
}

const WIN_INPUT_CS = [
  `using System;using System.Runtime.InteropServices;using System.Threading;`,
  `public static class ColoniaInput{`,
  `[StructLayout(LayoutKind.Sequential)]public struct MI{public int dx;public int dy;public uint data;public uint flags;public uint time;public IntPtr extra;}`,
  `[StructLayout(LayoutKind.Sequential)]public struct KI{public ushort vk;public ushort scan;public uint flags;public uint time;public IntPtr extra;}`,
  `[StructLayout(LayoutKind.Explicit)]public struct U{[FieldOffset(0)]public MI mi;[FieldOffset(0)]public KI ki;}`,
  `[StructLayout(LayoutKind.Sequential)]public struct INPUT{public uint type;public U u;}`,
  `[DllImport("user32.dll",SetLastError=true)]static extern uint SendInput(uint n,INPUT[] p,int cb);`,
  `[DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);`,
  `[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();`,
  // SendInput devuelve 0 cuando Windows lo bloquea: una ventana con permisos de administrador o la pantalla de UAC.
  `static void S(INPUT i){if(SendInput(1,new INPUT[]{i},Marshal.SizeOf(typeof(INPUT)))==0)throw new Exception("Windows blocked the input (error "+Marshal.GetLastWin32Error()+"): the window in front may run as administrator");}`,
  `static void M(uint f){INPUT i=new INPUT();i.type=0;i.u.mi.flags=f;S(i);}`,
  `public static void Key(ushort vk,bool up){INPUT i=new INPUT();i.type=1;i.u.ki.vk=vk;bool e=(vk>=33&&vk<=46)||vk==91;i.u.ki.flags=(e?1u:0u)|(up?2u:0u);S(i);}`,
  `static void Ch(char c){INPUT i=new INPUT();i.type=1;i.u.ki.scan=c;i.u.ki.flags=4;S(i);i.u.ki.flags=6;S(i);}`,
  `public static void Click(int x,int y){if(!SetCursorPos(x,y))throw new Exception("the pointer could not be moved there");Thread.Sleep(80);M(2);Thread.Sleep(30);M(4);}`,
  `public static void Text(string s){foreach(char c in s){if(c=='\\r')continue;if(c=='\\n'){Key(13,false);Key(13,true);}else if(c=='\\t'){Key(9,false);Key(9,true);}else Ch(c);Thread.Sleep(6);}}`,
  `}`,
].join("\n");

/** Corre DENTRO de la sesión del usuario: los pasos, uno a uno; al primero que falla se para y dice cuál. */
export function windowsDoInner(steps: readonly ScreenStep[], id: string): string {
  checkId(id);
  checkSteps(steps);
  const lines = steps.map((st, i) => {
    const n = `$n=${i + 1};`;
    if (st.do === "click") return `${n}[ColoniaInput]::Click(${st.x},${st.y});Start-Sleep -Milliseconds 150`;
    if (st.do === "type")
      // En base64: ni comillas (tampoco las tipográficas) ni saltos de línea del texto tocan el script.
      return `${n}[ColoniaInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(st.text, "utf8").toString("base64")}')))`;
    const { mods, key } = parseKeys(st.keys);
    const down = [...mods, key].map((k) => `[ColoniaInput]::Key(${k.vk},$false)`);
    const up = [key, ...[...mods].reverse()].map((k) => `[ColoniaInput]::Key(${k.vk},$true)`);
    return `${n}${[...down, ...up].join(";")};Start-Sleep -Milliseconds 120`;
  });
  return [
    `$ErrorActionPreference='Stop';$O=Join-Path $env:PUBLIC 'colonia-gui-${id}.txt';$n=0`,
    `try{`,
    `Add-Type -TypeDefinition @'`,
    WIN_INPUT_CS,
    `'@`,
    `[void][ColoniaInput]::SetProcessDPIAware()`,
    ...lines,
    `Set-Content -LiteralPath $O -Value 'DONE n=${steps.length}'`,
    `}catch{Set-Content -LiteralPath $O -Value ("STEP_ERROR i=$n "+$_.Exception.Message)}`,
  ].join("\n");
}

/**
 * La orden que lleva a la sesión del usuario el script ya subido (screenFiles(id).script, en la carpeta donde arranca
 * la terminal): lo lanza con una tarea de un solo uso, espera su resultado y lo borra todo. Con `image`, deja la captura
 * junto al script para leerla después.
 */
export function windowsDesktopScript(id: string, image: boolean): string {
  checkId(id);
  const f = screenFiles(id);
  return [
    `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'`,
    `$N='ColoniaPantalla-${id}';$D=[Environment]::CurrentDirectory;$S0=Join-Path $D ${psQuote(f.script)};$S=Join-Path $env:PUBLIC ${psQuote(f.script)};$O=Join-Path $env:PUBLIC 'colonia-gui-${id}.txt';$I=Join-Path $env:PUBLIC ${psQuote(f.jpg)}`,
    `try{`,
    `$me=[Security.Principal.WindowsIdentity]::GetCurrent().Name`,
    `$ex=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|?{$_.SessionId -ne 0})`,
    `if(!$ex){'COLONIA_GUI NO_SESSION';exit 3}`,
    `$ss=@($ex|%{$u='';try{$ow=Invoke-CimMethod -InputObject $_ -MethodName GetOwner;if($ow.User){$u="$($ow.Domain)\\$($ow.User)"}}catch{};[pscustomobject]@{S=$_.SessionId;U=$u}}|?{$_.U})`,
    `if(!$ss){'COLONIA_GUI OTHER_USER';exit 3}`,
    `$k=@($ss|?{$_.U -ieq $me})[0];if(!$k){$k=$ss[0]}`,
    // Con la pantalla bloqueada no hay nada que ver ni donde hacer clic: se dice, no se devuelve una imagen en negro.
    `if(Get-Process LogonUI -ErrorAction SilentlyContinue|?{$_.SessionId -eq $k.S}){'COLONIA_GUI LOCKED';exit 3}`,
    `Move-Item -LiteralPath $S0 -Destination $S -Force`,
    `try{`,
    // `iex` del archivo y no `-File`: no depende de la directiva de ejecución de scripts y lee el archivo como UTF-8.
    `Register-ScheduledTask -TaskName $N -Force -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command iex([IO.File]::ReadAllText('$S'))") -Principal (New-ScheduledTaskPrincipal -UserId $k.U -LogonType Interactive) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)|Out-Null`,
    `Start-ScheduledTask -TaskName $N`,
    `for($t=0;$t -lt 160 -and !(Test-Path -LiteralPath $O);$t++){Start-Sleep -Milliseconds 250}`,
    `}finally{Unregister-ScheduledTask -TaskName $N -Confirm:$false -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $S -Force -ErrorAction SilentlyContinue}`,
    `if(!(Test-Path -LiteralPath $O)){'COLONIA_GUI NOT_STARTED';exit 4}`,
    `$r=(Get-Content -LiteralPath $O -Raw).Trim();Remove-Item -LiteralPath $O -Force -ErrorAction SilentlyContinue`,
    `if($r -like 'ERR*'){'COLONIA_GUI ERROR '+$r.Substring(3).Trim();exit 5}`,
    ...(image
      ? [
          `if($r -like 'SHOT*'){Move-Item -LiteralPath $I -Destination (Join-Path $D ${psQuote(f.jpg)}) -Force;$r+=' file=${f.jpg}'}`,
        ]
      : []),
    `'COLONIA_GUI '+$r`,
    `}catch{'COLONIA_GUI ERROR '+$_.Exception.Message;exit 6}finally{Remove-Item -LiteralPath $S0,$I -Force -ErrorAction SilentlyContinue}`,
  ].join("\n");
}

// ── macOS ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Solo la cuenta que tiene la sesión gráfica ve y maneja su pantalla. */
const MAC_SAME_USER = `if [ "$uid" != "$me" ]; then echo "COLONIA_GUI OTHER_USER $u"; exit 3; fi`;
/** Un paso: si falla, se dice cuál y con qué error, y no se sigue. */
const SH_STEP = `r(){ e=$("$@" 2>&1) || { echo "COLONIA_GUI STEP_ERROR i=$n $(printf %s "$e" | tr '\\n' ' ')"; exit 5; }; }`;

export function macShotScript(id: string): string {
  checkId(id);
  const f = screenFiles(id).jpg;
  return [
    ...MAC_SESSION,
    MAC_SAME_USER,
    `F=${f}`,
    // Sin el permiso de Grabación de pantalla, screencapture falla o deja un archivo vacío.
    `e=$(screencapture -x -t jpg "$F" 2>&1)`,
    `if [ $? -ne 0 ] || [ ! -s "$F" ]; then rm -f "$F"; echo "COLONIA_GUI PERMISSION screen $(printf %s "$e" | tr '\\n' ' ')"; exit 5; fi`,
    `pw=$(sips -g pixelWidth "$F" 2>/dev/null | awk '/pixelWidth/{print $2}'); ph=$(sips -g pixelHeight "$F" 2>/dev/null | awk '/pixelHeight/{print $2}')`,
    `if [ "\${pw:-0}" -gt ${SCREEN_SHOT_MAX} ] || [ "\${ph:-0}" -gt ${SCREEN_SHOT_MAX} ]; then sips -Z ${SCREEN_SHOT_MAX} "$F" >/dev/null 2>&1; fi`,
    // Los clics van en puntos de pantalla, no en píxeles de la captura (una Retina tiene el doble).
    `set -- $(system_profiler SPDisplaysDataType 2>/dev/null | awk '/UI Looks like:/{print $4, $6; exit}')`,
    `if [ -z "$1" ]; then set -- $(system_profiler SPDisplaysDataType 2>/dev/null | awk '/Resolution:/{print $2, $4; exit}'); fi`,
    `echo "COLONIA_GUI SHOT x=0 y=0 sw=\${1:-\${pw:-0}} sh=\${2:-\${ph:-0}} file=$F"`,
  ].join("\n");
}

const macClick = (x: number, y: number) =>
  `ObjC.import("CoreGraphics");var p={x:${x},y:${y}};[$.kCGEventMouseMoved,$.kCGEventLeftMouseDown,$.kCGEventLeftMouseUp].forEach(function(t){$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateMouseEvent($(),t,p,$.kCGMouseButtonLeft));delay(0.06)})`;

export function macDoScript(steps: readonly ScreenStep[]): string {
  checkSteps(steps);
  const lines = steps.map((st, i) => {
    const n = `n=${i + 1}; `;
    if (st.do === "click") return `${n}r osascript -l JavaScript -e ${shQuote(macClick(st.x, st.y))}; sleep 0.15`;
    if (st.do === "type")
      return `${n}r osascript -l JavaScript -e 'function run(a){Application("System Events").keystroke(a[0])}' -- ${shQuote(st.text)}`;
    const { mods, key } = parseKeys(st.keys);
    const using = mods.length ? ` using {${mods.map((m) => m.using).join(", ")}}` : "";
    const what = typeof key.mac === "number" ? `key code ${key.mac}` : `keystroke "${key.mac}"`;
    return `${n}r osascript -e ${shQuote(`tell application "System Events" to ${what}${using}`)}; sleep 0.12`;
  });
  return [
    ...MAC_SESSION,
    MAC_SAME_USER,
    // Sin el permiso de Accesibilidad, macOS descarta los clics y las teclas sin decir nada: se comprueba antes.
    `t=$(osascript -l JavaScript -e 'ObjC.import("ApplicationServices");$.AXIsProcessTrusted()?"yes":"no"' 2>&1)`,
    `if [ "$t" != yes ]; then echo 'COLONIA_GUI PERMISSION accessibility'; exit 5; fi`,
    SH_STEP,
    `n=0`,
    ...lines,
    `echo 'COLONIA_GUI DONE n=${steps.length}'`,
  ].join("\n");
}

// ── Linux ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function linuxShotScript(id: string): string {
  checkId(id);
  const f = screenFiles(id);
  return [
    ...LINUX_SESSION,
    `F=${f.png}; J=${f.jpg}`,
    `if [ -n "$WAYLAND_DISPLAY" ] && command -v grim >/dev/null 2>&1; then e=$(grim "$F" 2>&1)`,
    `elif command -v gnome-screenshot >/dev/null 2>&1; then e=$(gnome-screenshot -f "$F" 2>&1)`,
    `elif command -v spectacle >/dev/null 2>&1; then e=$(spectacle -b -n -o "$F" 2>&1)`,
    `elif command -v scrot >/dev/null 2>&1; then e=$(scrot "$F" 2>&1)`,
    `elif command -v maim >/dev/null 2>&1; then e=$(maim "$F" 2>&1)`,
    `elif command -v import >/dev/null 2>&1; then e=$(import -window root "$F" 2>&1)`,
    `else echo 'COLONIA_GUI MISSING screenshot'; exit 5; fi`,
    `if [ ! -s "$F" ]; then rm -f "$F"; echo "COLONIA_GUI ERROR $(printf %s "$e" | tr '\\n' ' ')"; exit 5; fi`,
    // El tamaño de la pantalla es el del PNG tal como salió (bytes 16-23 de su cabecera), antes de reducirlo.
    `set -- $(od -An -tu1 -j16 -N8 "$F")`,
    `sw=$(( ($1<<24)+($2<<16)+($3<<8)+$4 )); sh=$(( ($5<<24)+($6<<16)+($7<<8)+$8 ))`,
    `C=$(command -v magick || command -v convert)`,
    `if [ -n "$C" ] && "$C" "$F" -resize '${SCREEN_SHOT_MAX}x${SCREEN_SHOT_MAX}>' -quality 70 "$J" >/dev/null 2>&1 && [ -s "$J" ]; then rm -f "$F"; F=$J; else rm -f "$J"; fi`,
    `echo "COLONIA_GUI SHOT x=0 y=0 sw=$sw sh=$sh file=$F"`,
  ].join("\n");
}

export function linuxDoScript(steps: readonly ScreenStep[]): string {
  checkSteps(steps);
  const lines = steps.map((st, i) => {
    const n = `n=${i + 1}; `;
    if (st.do === "click")
      return `${n}if [ $K = x ]; then r xdotool mousemove ${st.x} ${st.y} click 1; else r ydotool mousemove --absolute -x ${st.x} -y ${st.y}; r ydotool click 0xC0; fi; sleep 0.15`;
    if (st.do === "type")
      return `${n}if [ $K = x ]; then r xdotool type --clearmodifiers --delay 8 -- ${shQuote(st.text)}; else r ydotool type -- ${shQuote(st.text)}; fi`;
    const { mods, key } = parseKeys(st.keys);
    const all = [...mods, key];
    const ev = [...all.map((k) => `${k.ev}:1`), ...[...all].reverse().map((k) => `${k.ev}:0`)].join(" ");
    return `${n}if [ $K = x ]; then r xdotool key --clearmodifiers ${shQuote(all.map((k) => k.x).join("+"))}; else r ydotool key ${ev}; fi; sleep 0.12`;
  });
  return [
    ...LINUX_SESSION,
    // En Wayland, xdotool solo alcanza las ventanas de XWayland: allí va primero ydotool.
    `if [ -n "$WAYLAND_DISPLAY" ] && command -v ydotool >/dev/null 2>&1; then K=y`,
    `elif [ -n "$DISPLAY" ] && command -v xdotool >/dev/null 2>&1; then K=x`,
    `elif command -v ydotool >/dev/null 2>&1; then K=y`,
    `else echo "COLONIA_GUI MISSING $(if [ -n "$WAYLAND_DISPLAY" ]; then echo ydotool; else echo xdotool; fi)"; exit 5; fi`,
    SH_STEP,
    `n=0`,
    ...lines,
    `echo 'COLONIA_GUI DONE n=${steps.length}'`,
  ].join("\n");
}

// ── Lo que se ejecuta ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Una operación de pantalla, lista para el equipo: `upload` (solo Windows) es el script que se sube antes con
 * equipos.write_file; `command` va por equipos.run. Lanza si el sistema no se conoce o si la orden no cabe.
 */
export type ScreenPlan = { upload?: { path: string; content: string }; command: string };

const fits = (command: string): string => {
  if (command.length > GUI_COMMAND_MAX) throw new Error("that is too much for one go: split it in fewer steps");
  return command;
};
const unknownOs = () => new Error("that computer's system is not known, so its screen cannot be reached");

export function screenShotPlan(os_: RemoteOs, id: string): ScreenPlan {
  if (os_ === "windows")
    return {
      upload: { path: screenFiles(id).script, content: windowsShotInner(id) },
      command: fits(psEncoded(windowsDesktopScript(id, true))),
    };
  if (os_ === "macos") return { command: fits(macShotScript(id)) };
  if (os_ === "linux") return { command: fits(linuxShotScript(id)) };
  throw unknownOs();
}

export function screenDoPlan(os_: RemoteOs, steps: readonly ScreenStep[], id: string): ScreenPlan {
  if (os_ === "windows")
    return {
      upload: { path: screenFiles(id).script, content: windowsDoInner(steps, id) },
      command: fits(psEncoded(windowsDesktopScript(id, false))),
    };
  if (os_ === "macos") return { command: fits(macDoScript(steps)) };
  if (os_ === "linux") return { command: fits(linuxDoScript(steps)) };
  throw unknownOs();
}

/** Borra lo que la operación haya dejado en el equipo (la captura ya leída, un script que no llegó a correr). */
export function screenCleanupCommand(os_: RemoteOs, id: string): string {
  checkId(id);
  const f = screenFiles(id);
  return os_ === "windows"
    ? psEncoded(
        `Remove-Item -LiteralPath ${[f.script, f.jpg].map(psQuote).join(",")} -Force -ErrorAction SilentlyContinue`,
      )
    : `rm -f ${f.jpg} ${f.png}`;
}

// ── Lo que contesta el equipo ───────────────────────────────────────────────────────────────────────────────────────

export type ScreenResult =
  | { state: "shot"; x: number; y: number; width: number; height: number; file: string }
  | { state: "done"; steps: number }
  | { state: "step_error"; step: number; detail: string }
  | { state: "locked" }
  | { state: "permission"; what: "screen" | "accessibility"; detail: string }
  | { state: "missing"; what: string }
  | { state: "no_session" }
  | { state: "other_user"; who: string }
  | { state: "not_started" }
  | { state: "error"; detail: string };

export function parseScreenResult(output: string): ScreenResult {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .findLast((l) => l.startsWith("COLONIA_GUI "));
  if (!line) return { state: "error", detail: output.trim().slice(0, 600) || "the computer answered nothing" };
  const rest = line.slice("COLONIA_GUI ".length);
  const after = (word: string) => rest.slice(word.length).trim().slice(0, 600);
  const shot = /^SHOT x=(-?\d+) y=(-?\d+) sw=(\d+) sh=(\d+) file=(colonia-gui-[a-z0-9]+\.(?:jpg|png))$/i.exec(rest);
  if (shot)
    return {
      state: "shot",
      x: Number(shot[1]),
      y: Number(shot[2]),
      width: Number(shot[3]),
      height: Number(shot[4]),
      file: shot[5] ?? "",
    };
  const done = /^DONE n=(\d+)$/.exec(rest);
  if (done) return { state: "done", steps: Number(done[1]) };
  const step = /^STEP_ERROR i=(\d+)\s*(.*)$/.exec(rest);
  if (step) return { state: "step_error", step: Number(step[1]), detail: (step[2] ?? "").slice(0, 600) };
  if (rest.startsWith("LOCKED")) return { state: "locked" };
  if (rest.startsWith("PERMISSION accessibility")) return { state: "permission", what: "accessibility", detail: "" };
  if (rest.startsWith("PERMISSION screen"))
    return { state: "permission", what: "screen", detail: after("PERMISSION screen") };
  if (rest.startsWith("MISSING")) return { state: "missing", what: after("MISSING").slice(0, 40) };
  if (rest.startsWith("NO_SESSION")) return { state: "no_session" };
  if (rest.startsWith("OTHER_USER")) return { state: "other_user", who: after("OTHER_USER") };
  if (rest.startsWith("NOT_STARTED")) return { state: "not_started" };
  return { state: "error", detail: rest.replace(/^ERROR\s*/, "").slice(0, 600) };
}

/** Tipo y tamaño de una captura por sus primeros bytes (PNG o JPEG); undefined si no es ninguna de las dos. */
export function imageInfo(b: Buffer): { mime: "image/png" | "image/jpeg"; width: number; height: number } | undefined {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a)
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] ?? 0;
    // Los marcadores de inicio de imagen (SOF0-SOF15, menos DHT, JPG y DAC) llevan el alto y el ancho.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { mime: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return undefined;
}
