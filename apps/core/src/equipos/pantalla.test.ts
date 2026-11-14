// EQUIPO-GUI-1 · Ver y manejar la pantalla de un equipo conectado. Aquí se fija cómo se construyen las órdenes de la
// captura y de los clics, teclas y texto en los tres sistemas, cómo se lee lo que contesta el equipo y que la imagen
// vuelve por la lectura de archivos y se borra de allí. Nada de esto se ha ejecutado en un equipo real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { equiposBrief, equipoTools, screenSay } from "../tools/equipos.ts";
import { GUI_COMMAND_MAX } from "./gui.ts";
import {
  imageInfo,
  linuxDoScript,
  linuxShotScript,
  macDoScript,
  macShotScript,
  parseKeys,
  parseScreenResult,
  SCREEN_SHOT_MAX,
  type ScreenStep,
  screenCleanupCommand,
  screenDoPlan,
  screenFiles,
  screenShotPlan,
  windowsDesktopScript,
  windowsDoInner,
  windowsShotInner,
} from "./pantalla.ts";

const ID = "ab12cd34ef56";
const decoded = (command: string) => Buffer.from(command.split(" ").at(-1) ?? "", "base64").toString("utf16le");
const STEPS: ScreenStep[] = [
  { do: "click", x: 640, y: 210 },
  { do: "key", keys: "ctrl+l" },
  { do: "type", text: "hola 'mundo' $HOME\n" },
  { do: "key", keys: "enter" },
];

test("teclas: modificadores y tecla con los códigos de cada sistema; una desconocida se rechaza", () => {
  const k = parseKeys("Ctrl+Shift+T");
  assert.deepEqual(
    k.mods.map((m) => [m.vk, m.using, m.x, m.ev]),
    [
      [17, "control down", "ctrl", 29],
      [16, "shift down", "shift", 42],
    ],
  );
  assert.deepEqual(k.key, { vk: 84, mac: "t", x: "t", ev: 20 });
  assert.deepEqual(parseKeys("enter").key, { vk: 13, mac: 36, x: "Return", ev: 28 });
  assert.deepEqual(parseKeys("pagedown").key, { vk: 34, mac: 121, x: "Page_Down", ev: 109 });
  assert.deepEqual(parseKeys("f5").key, { vk: 116, mac: 96, x: "F5", ev: 63 });
  assert.deepEqual(parseKeys("f12").key, { vk: 123, mac: 111, x: "F12", ev: 88 });
  assert.equal(parseKeys("cmd+space").mods[0]?.using, "command down");
  assert.equal(parseKeys("win+r").mods[0]?.vk, 91);
  assert.equal(parseKeys("option+left").mods[0]?.using, "option down");
  assert.equal(parseKeys("0").key.ev, 11);
  assert.equal(parseKeys("l").key.ev, 38);
  assert.throws(() => parseKeys("ctrl+ñ"), /unknown key/);
  assert.throws(() => parseKeys("hyper+a"), /unknown modifier/);
});

test("Windows, captura: el script de dentro usa System.Drawing, cubre todas las pantallas y reduce al lado mayor", () => {
  const ps = windowsShotInner(ID);
  assert.match(ps, /Add-Type -AssemblyName System\.Drawing,System\.Windows\.Forms/);
  assert.match(ps, /SetProcessDPIAware\(\)/);
  assert.match(ps, /\[Windows\.Forms\.SystemInformation\]::VirtualScreen/);
  assert.match(ps, /CopyFromScreen\(\$b\.X,\$b\.Y,0,0,\$bmp\.Size\)/);
  assert.ok(ps.includes(`${SCREEN_SHOT_MAX}/[Math]::Max($b.Width,$b.Height)`));
  assert.match(ps, /image\/jpeg/);
  assert.match(ps, /\(\[long\]70\)/);
  assert.ok(ps.includes(`Join-Path $env:PUBLIC 'colonia-gui-${ID}.jpg'`));
  assert.match(
    ps,
    /Set-Content -LiteralPath \$O -Value "SHOT x=\$\(\$b\.X\) y=\$\(\$b\.Y\) sw=\$\(\$b\.Width\) sh=\$\(\$b\.Height\)"/,
  );
  assert.match(ps, /catch\{Set-Content -LiteralPath \$O -Value \('ERR '/);
  assert.throws(() => windowsShotInner("a'b"), /identificador/);
});

test("Windows, captura: el script sube como archivo y la orden lo lleva a la sesión del usuario y lo borra", () => {
  const plan = screenShotPlan("windows", ID);
  assert.deepEqual(plan.upload, { path: `colonia-gui-${ID}.ps1`, content: windowsShotInner(ID) });
  assert.match(plan.command, /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
  assert.ok(plan.command.length <= GUI_COMMAND_MAX, `la orden mide ${plan.command.length}`);
  const ps = decoded(plan.command);
  assert.equal(ps, windowsDesktopScript(ID, true));
  assert.match(ps, /Win32_Process -Filter "Name='explorer\.exe'"\|\?\{\$_\.SessionId -ne 0\}/);
  assert.match(ps, /New-ScheduledTaskPrincipal -UserId \$k\.U -LogonType Interactive/);
  assert.ok(ps.includes(`$N='ColoniaPantalla-${ID}'`));
  // Sin sesión o con la pantalla bloqueada lo dice antes de crear nada.
  assert.ok(ps.indexOf("COLONIA_GUI NO_SESSION") < ps.indexOf("Register-ScheduledTask"));
  assert.match(ps, /Get-Process LogonUI[^\n]*'COLONIA_GUI LOCKED'/);
  assert.ok(ps.indexOf("COLONIA_GUI LOCKED") < ps.indexOf("Register-ScheduledTask"));
  // El script se lee como texto (no depende de la directiva de ejecución) y la tarea y el script se quitan siempre.
  assert.match(ps, /-Command iex\(\[IO\.File\]::ReadAllText\('\$S'\)\)/);
  assert.match(
    ps,
    /\}finally\{Unregister-ScheduledTask -TaskName \$N -Confirm:\$false[^\n]*Remove-Item -LiteralPath \$S -Force/,
  );
  assert.match(ps, /finally\{Remove-Item -LiteralPath \$S0,\$I -Force/);
  // La captura vuelve a la carpeta de la terminal, de donde se lee, y la respuesta dice su nombre.
  assert.ok(
    ps.includes(
      `Move-Item -LiteralPath $I -Destination (Join-Path $D 'colonia-gui-${ID}.jpg') -Force;$r+=' file=colonia-gui-${ID}.jpg'`,
    ),
  );
  assert.doesNotMatch(windowsDesktopScript(ID, false), /file=colonia-gui/);
});

test("Windows, clic/tecla/texto: SendInput en la sesión del usuario, el texto en base64 y cada paso numerado", () => {
  const ps = windowsDoInner(STEPS, ID);
  assert.match(ps, /Add-Type -TypeDefinition @'\n/);
  assert.match(ps, /static extern uint SendInput\(uint n,INPUT\[\] p,int cb\)/);
  assert.match(ps, /static extern bool SetCursorPos\(int x,int y\)/);
  assert.match(ps, /\n'@\n\[void\]\[ColoniaInput\]::SetProcessDPIAware\(\)/);
  assert.ok(ps.includes("$n=1;[ColoniaInput]::Click(640,210)"));
  assert.ok(
    ps.includes(
      "$n=2;[ColoniaInput]::Key(17,$false);[ColoniaInput]::Key(76,$false);[ColoniaInput]::Key(76,$true);[ColoniaInput]::Key(17,$true)",
    ),
  );
  const b64 = Buffer.from("hola 'mundo' $HOME\n", "utf8").toString("base64");
  assert.ok(
    ps.includes(`$n=3;[ColoniaInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`),
  );
  // El texto no aparece tal cual: ni sus comillas ni su $ tocan el script.
  assert.ok(!ps.includes("'mundo'") && !ps.includes("$HOME"));
  assert.ok(ps.includes("$n=4;[ColoniaInput]::Key(13,$false);[ColoniaInput]::Key(13,$true)"));
  assert.match(ps, /Set-Content -LiteralPath \$O -Value 'DONE n=4'/);
  assert.match(ps, /catch\{Set-Content -LiteralPath \$O -Value \("STEP_ERROR i=\$n "/);
  const plan = screenDoPlan("windows", STEPS, ID);
  assert.equal(plan.upload?.content, ps);
  assert.equal(decoded(plan.command), windowsDesktopScript(ID, false));
  // Un texto largo no agranda la orden: viaja en el archivo.
  const long = screenDoPlan("windows", [{ do: "type", text: "x".repeat(2000) }], ID);
  assert.equal(long.command, plan.command);
});

test("macOS, captura: screencapture, aviso del permiso de Grabación de pantalla y puntos de pantalla", () => {
  const sh = macShotScript(ID);
  assert.equal(screenShotPlan("macos", ID).command, sh);
  assert.equal(screenShotPlan("macos", ID).upload, undefined);
  assert.match(sh, /stat -f%Su \/dev\/console/);
  assert.match(sh, /if \[ "\$uid" != "\$me" \]; then echo "COLONIA_GUI OTHER_USER \$u"; exit 3; fi/);
  assert.ok(sh.includes(`F=colonia-gui-${ID}.jpg`));
  assert.match(sh, /e=\$\(screencapture -x -t jpg "\$F" 2>&1\)/);
  assert.match(sh, /\[ ! -s "\$F" \]; then rm -f "\$F"; echo "COLONIA_GUI PERMISSION screen /);
  assert.ok(sh.includes(`sips -Z ${SCREEN_SHOT_MAX} "$F"`));
  assert.match(sh, /UI Looks like:/);
  assert.match(sh, /echo "COLONIA_GUI SHOT x=0 y=0 sw=.* file=\$F"/);
});

test("macOS, clic/tecla/texto: comprueba Accesibilidad antes y usa osascript; el texto va como argumento", () => {
  const sh = macDoScript(STEPS);
  assert.match(sh, /AXIsProcessTrusted\(\)/);
  assert.ok(sh.indexOf("COLONIA_GUI PERMISSION accessibility") < sh.indexOf("n=1;"));
  assert.match(sh, /n=1; r osascript -l JavaScript -e '[^']*var p=\{x:640,y:210\}[^']*kCGEventLeftMouseDown[^']*'/);
  assert.ok(
    sh.includes(`n=2; r osascript -e 'tell application "System Events" to keystroke "l" using {control down}'`),
  );
  assert.ok(
    sh.includes(
      `n=3; r osascript -l JavaScript -e 'function run(a){Application("System Events").keystroke(a[0])}' -- 'hola '\\''mundo'\\'' $HOME\n'`,
    ),
  );
  assert.ok(sh.includes(`n=4; r osascript -e 'tell application "System Events" to key code 36'`));
  assert.match(sh, /echo "COLONIA_GUI STEP_ERROR i=\$n /);
  assert.match(sh, /echo 'COLONIA_GUI DONE n=4'$/);
  assert.ok(
    macDoScript([{ do: "key", keys: "cmd+shift+4" }]).includes(`keystroke "4" using {command down, shift down}`),
  );
});

test("Linux, captura: grim en Wayland y si no lo que haya; sin ninguno lo dice; el tamaño sale del PNG", () => {
  const sh = linuxShotScript(ID);
  assert.equal(screenShotPlan("linux", ID).command, sh);
  assert.match(
    sh,
    /if \[ -n "\$WAYLAND_DISPLAY" \] && command -v grim >\/dev\/null 2>&1; then e=\$\(grim "\$F" 2>&1\)/,
  );
  for (const tool of ["gnome-screenshot -f", "spectacle -b -n -o", "scrot", "maim", "import -window root"])
    assert.ok(sh.includes(`e=$(${tool} "$F" 2>&1)`), tool);
  assert.match(sh, /else echo 'COLONIA_GUI MISSING screenshot'; exit 5; fi/);
  assert.match(sh, /od -An -tu1 -j16 -N8 "\$F"/);
  assert.ok(sh.includes(`-resize '${SCREEN_SHOT_MAX}x${SCREEN_SHOT_MAX}>' -quality 70 "$J"`));
  assert.ok(sh.includes(`F=colonia-gui-${ID}.png; J=colonia-gui-${ID}.jpg`));
  assert.match(sh, /echo "COLONIA_GUI SHOT x=0 y=0 sw=\$sw sh=\$sh file=\$F"$/);
  // Entra antes en la sesión gráfica (o dice que no la hay).
  assert.ok(sh.indexOf("COLONIA_GUI NO_SESSION") < sh.indexOf("grim"));
});

test("Linux, clic/tecla/texto: xdotool o ydotool según la sesión; si falta, dice cuál", () => {
  const sh = linuxDoScript(STEPS);
  assert.match(sh, /if \[ -n "\$WAYLAND_DISPLAY" \] && command -v ydotool >\/dev\/null 2>&1; then K=y/);
  assert.match(sh, /elif \[ -n "\$DISPLAY" \] && command -v xdotool >\/dev\/null 2>&1; then K=x/);
  assert.match(
    sh,
    /else echo "COLONIA_GUI MISSING \$\(if \[ -n "\$WAYLAND_DISPLAY" \]; then echo ydotool; else echo xdotool; fi\)"; exit 5; fi/,
  );
  assert.ok(
    sh.includes(
      "n=1; if [ $K = x ]; then r xdotool mousemove 640 210 click 1; else r ydotool mousemove --absolute -x 640 -y 210; r ydotool click 0xC0; fi",
    ),
  );
  assert.ok(
    sh.includes(
      "n=2; if [ $K = x ]; then r xdotool key --clearmodifiers 'ctrl+l'; else r ydotool key 29:1 38:1 38:0 29:0; fi",
    ),
  );
  assert.ok(
    sh.includes(
      `n=3; if [ $K = x ]; then r xdotool type --clearmodifiers --delay 8 -- 'hola '\\''mundo'\\'' $HOME\n'; else r ydotool type -- 'hola '\\''mundo'\\'' $HOME\n'; fi`,
    ),
  );
  assert.ok(sh.includes("r xdotool key --clearmodifiers 'Return'; else r ydotool key 28:1 28:0; fi"));
  assert.match(sh, /echo 'COLONIA_GUI DONE n=4'$/);
});

test("los pasos se validan antes de construir nada, y un sistema desconocido se rechaza", () => {
  assert.throws(() => screenDoPlan("linux", [], ID), /between 1 and 12 steps/);
  assert.throws(() => screenDoPlan("macos", [{ do: "key", keys: "ctrl+ñ" }], ID), /unknown key/);
  assert.throws(() => screenDoPlan("windows", [{ do: "click", x: 1.5, y: 2 }], ID), /whole x and y/);
  assert.throws(() => screenDoPlan("linux", [{ do: "type", text: "a\0b" }], ID), /empty or too long/);
  assert.throws(() => screenShotPlan("unknown" as never, ID), /system is not known/);
  // Doce textos del máximo no caben en una orden de sh: se dice, no se corta.
  const many: ScreenStep[] = Array.from({ length: 12 }, () => ({ do: "type", text: "x".repeat(2000) }));
  assert.throws(() => screenDoPlan("linux", many, ID), /split it in fewer steps/);
});

test("limpieza: borra del equipo la captura y el script por su nombre", () => {
  assert.equal(screenCleanupCommand("linux", ID), `rm -f colonia-gui-${ID}.jpg colonia-gui-${ID}.png`);
  assert.equal(
    decoded(screenCleanupCommand("windows", ID)),
    `Remove-Item -LiteralPath 'colonia-gui-${ID}.ps1','colonia-gui-${ID}.jpg' -Force -ErrorAction SilentlyContinue`,
  );
  assert.deepEqual(
    Object.values(screenFiles(ID)).every((f) => /^colonia-gui-[a-z0-9]+\.(ps1|jpg|png)$/.test(f)),
    true,
  );
});

test("lo que contesta el equipo: captura, pasos hechos, paso fallido y cada cosa que puede faltar", () => {
  assert.deepEqual(
    parseScreenResult(`ruido\r\nCOLONIA_GUI SHOT x=-1920 y=0 sw=3840 sh=1080 file=colonia-gui-${ID}.jpg\r\n`),
    {
      state: "shot",
      x: -1920,
      y: 0,
      width: 3840,
      height: 1080,
      file: `colonia-gui-${ID}.jpg`,
    },
  );
  // Un nombre de archivo que no es el nuestro no se acepta como captura (no se lee cualquier ruta del equipo).
  assert.equal(parseScreenResult("COLONIA_GUI SHOT x=0 y=0 sw=1 sh=1 file=../../etc/passwd").state, "error");
  assert.deepEqual(parseScreenResult("COLONIA_GUI DONE n=4"), { state: "done", steps: 4 });
  assert.deepEqual(parseScreenResult("COLONIA_GUI STEP_ERROR i=2 Windows blocked the input (error 5)"), {
    state: "step_error",
    step: 2,
    detail: "Windows blocked the input (error 5)",
  });
  assert.deepEqual(parseScreenResult("COLONIA_GUI LOCKED"), { state: "locked" });
  assert.deepEqual(parseScreenResult("COLONIA_GUI PERMISSION accessibility"), {
    state: "permission",
    what: "accessibility",
    detail: "",
  });
  assert.deepEqual(parseScreenResult("COLONIA_GUI PERMISSION screen could not create image"), {
    state: "permission",
    what: "screen",
    detail: "could not create image",
  });
  assert.deepEqual(parseScreenResult("COLONIA_GUI MISSING xdotool"), { state: "missing", what: "xdotool" });
  assert.deepEqual(parseScreenResult("COLONIA_GUI NO_SESSION"), { state: "no_session" });
  assert.deepEqual(parseScreenResult("COLONIA_GUI OTHER_USER ana"), { state: "other_user", who: "ana" });
  assert.deepEqual(parseScreenResult("COLONIA_GUI NOT_STARTED"), { state: "not_started" });
  assert.deepEqual(parseScreenResult("COLONIA_GUI ERROR Acceso denegado."), {
    state: "error",
    detail: "Acceso denegado.",
  });
  assert.deepEqual(parseScreenResult(""), { state: "error", detail: "the computer answered nothing" });
});

test("lo que se le dice al agente cuando no se puede: qué falta y cómo se arregla, sin mandar a buscar otra conexión", () => {
  assert.match(
    screenSay({ state: "locked" }, "PC", "no picture taken"),
    /^no picture taken: the screen of PC is locked.*unlock/,
  );
  assert.match(
    screenSay({ state: "no_session" }, "PC", "nothing was done"),
    /nobody is signed in on PC.*no other connection is needed/,
  );
  const acc = screenSay({ state: "permission", what: "accessibility", detail: "" }, "Mac", "nothing was done");
  assert.match(acc, /Privacy & Security › Accessibility/);
  assert.match(acc, /x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_Accessibility/);
  assert.match(
    screenSay({ state: "permission", what: "screen", detail: "" }, "Mac", "no picture taken"),
    /Screen Recording.*Privacy_ScreenCapture/,
  );
  assert.match(
    screenSay({ state: "missing", what: "xdotool" }, "pc", "nothing was done"),
    /has no xdotool.*install it with equipo_run/,
  );
  assert.match(screenSay({ state: "missing", what: "ydotool" }, "pc", "nothing was done"), /ydotoold/);
  assert.match(screenSay({ state: "missing", what: "screenshot" }, "pc", "no picture taken"), /grim on Wayland.*scrot/);
  assert.match(screenSay({ state: "step_error", step: 2, detail: "boom" }, "PC", "x"), /^step 2 failed on PC: boom/);
});

/** Un JPEG mínimo con su marcador de tamaño (SOF0), como el que deja la captura. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
}

test("tamaño de la imagen por sus bytes: JPEG y PNG; otra cosa no es una captura", () => {
  assert.deepEqual(imageInfo(jpeg(1600, 900)), { mime: "image/jpeg", width: 1600, height: 900 });
  const png = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1080, 20);
  assert.deepEqual(imageInfo(png), { mime: "image/png", width: 1920, height: 1080 });
  assert.equal(imageInfo(Buffer.from("no es una imagen")), undefined);
  assert.equal(imageInfo(Buffer.alloc(0)), undefined);
});

const pc = (platform: string) => ({
  id: "eqp_1",
  name: "DESKTOP-EVN2V0D",
  platform,
  public_key: "",
  agent_access: true,
  created_at: "2026-11-14T00:00:00Z",
  transport: "ssh",
  address: "192.168.1.3",
});
type Call = {
  method: string;
  params: { equipo: string; command?: string; path?: string; content_base64?: string; timeout_s?: number };
};

/** Un equipo falso: contesta a cada orden lo que diga `answer` y entrega `image` cuando se lee la captura. */
function fake(platform: string, answer: (command: string) => string, image: Buffer) {
  const calls: Call[] = [];
  const seen: { media_id: string; mime: string }[] = [];
  const saved: { name: string; mime: string; bytes: Buffer; thread?: string | undefined }[] = [];
  const store = { team: { list: () => [pc(platform)] }, settings: { get: () => "es" } } as never;
  const tools = equipoTools(store, (a) => {
    saved.push(a);
    return { id: `med_${saved.length}` };
  });
  const ctx = {
    thread: { id: "thr_1" },
    see: (i: { media_id: string; mime: string }) => seen.push(i),
    call: async (method: string, params: Call["params"]) => {
      calls.push({ method, params });
      if (method === "equipos.write_file") return { written: 1 };
      if (method === "equipos.read_file")
        return { content_base64: image.toString("base64"), size: image.length, truncated: false };
      return { exit_code: 0, output: answer(params.command ?? ""), truncated: false };
    },
  } as never;
  const tool = (name: string) => {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, name);
    return t;
  };
  return { calls, seen, saved, ctx, tool, store };
}

test("equipo_screenshot en Windows: sube el script, lo lanza, trae la imagen por la lectura de archivos y limpia", async () => {
  const f = fake(
    "windows",
    (c) => {
      const m = /ColoniaPantalla-([0-9a-f]{12})/.exec(decoded(c));
      return m ? `COLONIA_GUI SHOT x=0 y=0 sw=3200 sh=1800 file=colonia-gui-${m[1]}.jpg\r\n` : "";
    },
    jpeg(1600, 900),
  );
  const t = f.tool("equipo_screenshot");
  assert.equal(t.confirm({}), "untrusted");
  assert.equal(t.keepsCard?.({ equipo: "192.168.1.3" }, {} as never), "grant");
  const said = String(await t.run({ equipo: "192.168.1.3" }, f.ctx));
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["equipos.write_file", "equipos.run", "equipos.read_file", "equipos.run"],
  );
  const id = /colonia-gui-([0-9a-f]{12})\.ps1/.exec(f.calls[0]?.params.path ?? "")?.[1] ?? "";
  assert.equal(id.length, 12);
  assert.equal(Buffer.from(f.calls[0]?.params.content_base64 ?? "", "base64").toString("utf8"), windowsShotInner(id));
  assert.equal(decoded(f.calls[1]?.params.command ?? ""), windowsDesktopScript(id, true));
  assert.equal(f.calls[1]?.params.timeout_s, 90);
  assert.equal(f.calls[2]?.params.path, `colonia-gui-${id}.jpg`);
  assert.equal(f.calls[3]?.params.command, screenCleanupCommand("windows", id));
  // La imagen se guarda en el hilo y se le enseña al modelo; el texto dice cómo pasar de sus píxeles a la pantalla.
  assert.equal(f.saved.length, 1);
  assert.deepEqual([f.saved[0]?.name, f.saved[0]?.mime, f.saved[0]?.thread], ["screen.jpg", "image/jpeg", "thr_1"]);
  assert.deepEqual(f.seen, [{ media_id: "med_1", mime: "image/jpeg" }]);
  assert.match(said, /trust="untrusted"/);
  assert.match(said, /the picture is 1600x900 px: its pixel \(px,py\) is the screen point \(px\*2, py\*2\)/);
  assert.match(said, /whole screen of DESKTOP-EVN2V0D \(3200x1800\)/);
});

test("equipo_screenshot: cuando no se puede, dice qué falta, no lee ningún archivo y limpia igualmente", async () => {
  const f = fake(
    "windows",
    (c) => (decoded(c).includes("ColoniaPantalla") ? "COLONIA_GUI LOCKED\r\n" : ""),
    jpeg(1, 1),
  );
  const said = String(await f.tool("equipo_screenshot").run({ equipo: "eqp_1" }, f.ctx));
  assert.match(said, /^no picture taken: the screen of DESKTOP-EVN2V0D is locked/);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["equipos.write_file", "equipos.run", "equipos.run"],
  );
  assert.equal(f.saved.length, 0);
  const mac = fake("macos", (c) => (c.includes("screencapture") ? "COLONIA_GUI PERMISSION screen\n" : ""), jpeg(1, 1));
  assert.match(String(await mac.tool("equipo_screenshot").run({ equipo: "eqp_1" }, mac.ctx)), /Screen Recording/);
  assert.deepEqual(
    mac.calls.map((c) => c.method),
    ["equipos.run", "equipos.run"],
  );
});

test("equipo_do en Linux: pide permiso siempre, valida los pasos antes y mira la pantalla después", async () => {
  const f = fake(
    "linux",
    (c) => {
      if (c.includes("xdotool")) return "COLONIA_GUI DONE n=2\n";
      const m = /F=colonia-gui-([0-9a-f]{12})\.png/.exec(c);
      return m ? `COLONIA_GUI SHOT x=0 y=0 sw=1920 sh=1080 file=colonia-gui-${m[1]}.jpg\n` : "";
    },
    jpeg(1600, 900),
  );
  const t = f.tool("equipo_do");
  assert.equal(t.confirm({}), "always");
  assert.throws(
    () => t.check?.({ equipo: "eqp_1", steps: [{ do: "click", x: 1 }] } as never, {} as never),
    /step 1 \(click\) is missing x and y/,
  );
  assert.throws(
    () => t.check?.({ equipo: "eqp_1", steps: [{ do: "key", keys: "ctrl+ñ" }] } as never, {} as never),
    /unknown key/,
  );
  const steps = [
    { do: "click", x: 10, y: 20 },
    { do: "type", text: "hola" },
  ];
  assert.equal(t.title?.({ equipo: "PC", steps }), "En PC: click 10,20 → type «hola»");
  const said = String(await t.run({ equipo: "eqp_1", steps } as never, f.ctx));
  assert.equal(f.calls[0]?.method, "equipos.run");
  assert.equal(f.calls[0]?.params.command, linuxDoScript(steps as ScreenStep[]));
  assert.match(said, /^did 2 steps on the screen of DESKTOP-EVN2V0D: click 10,20 → type «hola»\nthe screen now:\n/);
  assert.match(said, /screen point \(px\*1\.2, py\*1\.2\)/);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["equipos.run", "equipos.run", "equipos.read_file", "equipos.run"],
  );
  // Sin mirar después: una sola orden.
  f.calls.length = 0;
  const quiet = String(await t.run({ equipo: "eqp_1", steps, look: false } as never, f.ctx));
  assert.match(quiet, /take an equipo_screenshot to check it worked$/);
  assert.equal(f.calls.length, 1);
});

test("equipo_do: un paso que falla o un programa que falta se cuentan tal cual; en Windows el script se borra", async () => {
  const f = fake(
    "windows",
    (c) =>
      decoded(c).includes("ColoniaPantalla")
        ? "COLONIA_GUI STEP_ERROR i=2 Windows blocked the input (error 5)\r\n"
        : "",
    jpeg(1, 1),
  );
  const steps = [
    { do: "click", x: 1, y: 2 },
    { do: "key", keys: "enter" },
  ];
  const said = String(await f.tool("equipo_do").run({ equipo: "eqp_1", steps } as never, f.ctx));
  assert.match(said, /^step 2 failed on DESKTOP-EVN2V0D: Windows blocked the input \(error 5\)/);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["equipos.write_file", "equipos.run", "equipos.run"],
  );
  const lin = fake("linux", () => "COLONIA_GUI MISSING xdotool\n", jpeg(1, 1));
  assert.match(String(await lin.tool("equipo_do").run({ equipo: "eqp_1", steps } as never, lin.ctx)), /has no xdotool/);
  assert.equal(lin.calls.length, 1);
  // El prompt ya ofrece ver y manejar la pantalla.
  const brief = equiposBrief(f.store);
  assert.match(brief, /To see that screen use equipo_screenshot, and to click or type on it equipo_do/);
  assert.doesNotMatch(brief, /You cannot see or click on their screen yet/);
});
