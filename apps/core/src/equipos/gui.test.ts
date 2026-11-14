// EQUIPO-GUI-1 · «Ábreme la calculadora en el otro PC» terminaba sin error y la calculadora no aparecía: por terminal
// remota, Windows la arrancaba en una sesión sin escritorio. Aquí se fija cómo se construye la orden que la lleva a la
// sesión de quien tiene delante el equipo, en los tres sistemas, y cómo se lee lo que contesta.
import assert from "node:assert/strict";
import { test } from "node:test";
import { equiposBrief, equipoTools, guiSay } from "../tools/equipos.ts";
import {
  GUI_ARGS_MAX,
  GUI_COMMAND_MAX,
  GUI_TARGET_MAX,
  guiOpenCommand,
  guiOs,
  linuxGuiScript,
  macGuiScript,
  parseGuiResult,
  winArg,
  windowsGuiScript,
} from "./gui.ts";

const ID = "ab12cd34ef56";
/** El script que de verdad recibe PowerShell: el base64 de la orden, de vuelta a texto. */
const decoded = (command: string) => Buffer.from(command.split(" ").at(-1) ?? "", "base64").toString("utf16le");

test("Windows: la orden va a la sesión del usuario conectado con una tarea de un solo uso que se borra siempre", () => {
  const command = guiOpenCommand("windows", { target: "calc" }, ID);
  assert.match(command, /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
  const ps = decoded(command);
  assert.equal(ps, windowsGuiScript({ target: "calc" }, ID));
  // Quién tiene escritorio: un explorer.exe fuera de la sesión 0, y su dueño.
  assert.match(ps, /Win32_Process -Filter "Name='explorer\.exe'"\|\?\{\$_\.SessionId -ne 0\}/);
  assert.match(ps, /-MethodName GetOwner/);
  // La tarea: interactiva, del usuario con sesión, también con batería; se lanza y se borra en un finally.
  assert.match(ps, /New-ScheduledTaskPrincipal -UserId \$k\.U -LogonType Interactive/);
  assert.match(ps, /-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries/);
  assert.match(ps, /Start-ScheduledTask -TaskName \$N/);
  assert.match(ps, /\}finally\{Unregister-ScheduledTask -TaskName \$N -Confirm:\$false/);
  assert.ok(ps.includes(`$N='ColoniaAbrir-${ID}'`) && ps.includes(`'colonia-gui-${ID}.txt'`));
  assert.ok(ps.includes("$T='calc';$A=''"));
  // Sin nadie con la sesión iniciada lo dice, antes de crear nada.
  assert.ok(ps.indexOf("COLONIA_GUI NO_SESSION") < ps.indexOf("Register-ScheduledTask"));
  // Tras abrir comprueba que sigue vivo: el proceso lanzado o los nacidos en esa sesión desde entonces.
  assert.match(ps, /Start-Sleep -Seconds 2[\s\S]*Get-Process -Id \$id[\s\S]*\$_\.StartTime -ge \$t0/);
});

test("Windows: nada de lo que se abre se interpreta, y la orden más larga admitida cabe", () => {
  const ps = windowsGuiScript(
    { target: "C:\\Users\\O'Neil\\informe final.pdf", args: ["--a b", 'di "hola"', "x"] },
    ID,
  );
  assert.ok(ps.includes("$T='C:\\Users\\O''Neil\\informe final.pdf'"));
  assert.ok(ps.includes(`$A='"--a b" "di \\"hola\\"" x'`));
  assert.equal(winArg("simple"), "simple");
  assert.equal(winArg(""), '""');
  assert.equal(winArg("C:\\con espacio\\"), '"C:\\con espacio\\\\"');
  const max = guiOpenCommand("windows", { target: "x".repeat(GUI_TARGET_MAX), args: ["y".repeat(GUI_ARGS_MAX)] }, ID);
  assert.ok(max.length <= GUI_COMMAND_MAX, `${max.length} caracteres`);
  // Lleno de comillas (cada una se dobla) ya no cabe: se dice, no se manda una orden cortada.
  assert.throws(() => guiOpenCommand("windows", { target: "'".repeat(GUI_TARGET_MAX) }, ID), /too long/);
  assert.throws(() => guiOpenCommand("windows", { target: "x".repeat(GUI_TARGET_MAX + 1) }, ID), /too long/);
  assert.throws(() => guiOpenCommand("windows", { target: "calc\n& del" }, ID), /line breaks/);
  assert.throws(() => guiOpenCommand("windows", { target: "calc" }, "a'; rm"), /no válido/);
  assert.throws(() => guiOpenCommand("other", { target: "calc" }, ID), /system is not known/);
});

test("macOS: `open -a` para una app, `open` para un archivo o una dirección, y launchctl asuser si la sesión es de otro", () => {
  const sh = guiOpenCommand("macos", { target: "Calculator" }, ID);
  assert.equal(sh, macGuiScript({ target: "Calculator" }));
  assert.ok(sh.startsWith("T='Calculator'\n"));
  assert.match(sh, /stat -f%Su \/dev\/console/);
  assert.match(sh, /\[ "\$u" = root \][^\n]*COLONIA_GUI NO_SESSION/);
  assert.ok(
    sh.includes(
      `if [ -e "$T" ]; then set -- "$T"; else case "$T" in *://*) set -- "$T";; *) app=1; set -- -a "$T";; esac; fi`,
    ),
  );
  assert.ok(sh.includes(`e=$(open "$@" 2>&1)`));
  assert.ok(sh.includes(`sudo -n launchctl asuser "$uid" sudo -n -u "$u" open "$@"`));
  assert.match(sh, /sleep 2[\s\S]*pgrep -u "\$uid" -if -- "\$T"/);
  assert.ok(!sh.includes("--args"));
  const withArgs = macGuiScript({ target: "It's Chrome", args: ["--new-window", "a'b"] });
  assert.ok(withArgs.startsWith(`T='It'\\''s Chrome'\n`));
  assert.ok(withArgs.includes(`set -- "$@" --args '--new-window' 'a'\\''b'`));
});

test("Linux: con DISPLAY/WAYLAND_DISPLAY y DBUS tomados de la sesión gráfica del usuario", () => {
  const sh = guiOpenCommand("linux", { target: "gnome-calculator", args: ["-m", "modo raro"] }, ID);
  assert.equal(sh, linuxGuiScript({ target: "gnome-calculator", args: ["-m", "modo raro"] }));
  assert.ok(sh.includes(`< "/proc/$p/environ" 2>/dev/null | grep -Eq '^(WAYLAND_DISPLAY|DISPLAY)=.'`));
  assert.match(sh, /for k in DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR /);
  assert.ok(sh.includes(`DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$me/bus"`));
  // Sin sesión gráfica propia: o es de otro usuario, o no hay nadie.
  assert.match(sh, /COLONIA_GUI OTHER_USER \$o[^\n]*COLONIA_GUI NO_SESSION/);
  assert.ok(sh.includes(`$S nohup "$T" '-m' 'modo raro' >/dev/null 2>&1 &`));
  assert.ok(sh.includes(`kill -0 "$pid"`));
  assert.ok(sh.includes(`xdg-open "$T" || gio open "$T"`));
});

test("el sistema del equipo se reconoce con los nombres que guarda cada tipo de conexión", () => {
  assert.deepEqual(["win32", "windows", "darwin", "macos", "linux", "freebsd"].map(guiOs), [
    "windows",
    "windows",
    "macos",
    "macos",
    "linux",
    "other",
  ]);
});

test("lo que contesta el equipo se lee de su línea COLONIA_GUI, aunque haya ruido alrededor", () => {
  assert.deepEqual(
    parseGuiResult(
      "#< CLIXML\r\nCOLONIA_GUI OK user=DESKTOP-EVN2V0D\\adero perez locked=False pid=4312 alive=True new=notepad\r\n",
    ),
    { state: "opened", user: "DESKTOP-EVN2V0D\\adero perez", locked: false, alive: true, started: ["notepad"] },
  );
  // calc.exe arranca la Calculadora y sale: cuenta lo que nació en la sesión.
  assert.deepEqual(
    parseGuiResult("COLONIA_GUI OK user=PC\\adero locked=True pid=99 alive=False new=CalculatorApp,RuntimeBroker"),
    { state: "opened", user: "PC\\adero", locked: true, alive: true, started: ["CalculatorApp", "RuntimeBroker"] },
  );
  const alive = (out: string) => (parseGuiResult(out) as { alive?: boolean }).alive;
  assert.equal(alive("COLONIA_GUI OK user=a locked=False pid=9 alive=False new="), false);
  assert.equal(alive("COLONIA_GUI OK user=ana locked=unknown pid=0 alive=unknown new="), undefined);
  assert.deepEqual(parseGuiResult("COLONIA_GUI NO_SESSION"), { state: "no_session" });
  assert.deepEqual(parseGuiResult("COLONIA_GUI OTHER_USER ana "), { state: "other_user", who: "ana" });
  assert.deepEqual(parseGuiResult("COLONIA_GUI NOT_STARTED"), { state: "not_started" });
  assert.deepEqual(parseGuiResult("COLONIA_GUI LAUNCH_ERROR no existe ese archivo"), {
    state: "error",
    detail: "no existe ese archivo",
  });
  assert.deepEqual(parseGuiResult("COLONIA_GUI ERROR Acceso denegado."), {
    state: "error",
    detail: "Acceso denegado.",
  });
  assert.deepEqual(parseGuiResult("sh: 1: stat: not found\n"), { state: "error", detail: "sh: 1: stat: not found" });
});

test("al agente se le dice qué pasó y, si no se pudo, qué falta exactamente; nunca que busque otra conexión", () => {
  const say = (out: string) => guiSay(parseGuiResult(out), "PC", "calc");
  assert.equal(
    say("COLONIA_GUI OK user=PC\\adero locked=False pid=9 alive=False new=CalculatorApp"),
    "opened calc on the desktop of PC, signed in as PC\\adero; checked two seconds later: it is running. Started there just now: CalculatorApp.",
  );
  assert.match(say("COLONIA_GUI OK user=a locked=True pid=9 alive=True new="), /is locked/);
  assert.match(say("COLONIA_GUI OK user=a locked=False pid=9 alive=False new="), /do not claim it is open/);
  assert.match(
    guiSay({ state: "no_session" }, "DESKTOP-EVN2V0D", "calc"),
    /^not opened: nobody is signed in on DESKTOP-EVN2V0D/,
  );
  assert.match(
    guiSay({ state: "other_user", who: "ana" }, "PC", "calc"),
    /another user \(ana\).*\[Mis equipos\]\(colonia:equipos\)/,
  );
  assert.match(guiSay({ state: "not_started" }, "PC", "calc"), /Nothing was left behind/);
  assert.equal(
    guiSay({ state: "error", detail: "Acceso denegado." }, "PC", "calc"),
    "not opened on PC: Acceso denegado.",
  );
});

test("equipo_open ejecuta la orden del sistema de ese equipo por el camino de equipo_run y cuenta el resultado", async () => {
  const pc = {
    id: "eqp_1",
    name: "DESKTOP-EVN2V0D",
    platform: "windows",
    public_key: "",
    agent_access: true,
    created_at: "2026-11-14T00:00:00Z",
    transport: "ssh",
    address: "192.168.1.3",
  };
  const store = { team: { list: () => [pc] }, settings: { get: () => "es" } } as never;
  const open = equipoTools(store).find((t) => t.name === "equipo_open");
  assert.ok(open);
  assert.equal(open.keepsCard?.({ equipo: "192.168.1.3", target: "calc" }, {} as never), "grant");
  const calls: { method: string; params: { equipo: string; command: string; timeout_s: number } }[] = [];
  let output = "COLONIA_GUI OK user=DESKTOP-EVN2V0D\\adero locked=False pid=7 alive=False new=CalculatorApp\r\n";
  const ctx = {
    call: async (method: string, params: never) => {
      calls.push({ method, params });
      return { exit_code: 0, output, truncated: false };
    },
  } as never;
  const said = await open.run({ equipo: "adero@192.168.1.3", target: "calc" }, ctx);
  assert.match(String(said), /^opened calc on the desktop of DESKTOP-EVN2V0D.*it is running/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "equipos.run");
  assert.equal(calls[0]?.params.equipo, "eqp_1");
  assert.equal(calls[0]?.params.timeout_s, 60);
  assert.match(decoded(calls[0]?.params.command ?? ""), /\$T='calc';\$A='';\$N='ColoniaAbrir-[0-9a-f]{12}'/);
  output = "COLONIA_GUI NO_SESSION\r\n";
  assert.match(
    String(await open.run({ equipo: "eqp_1", target: "calc" }, ctx)),
    /nobody is signed in on DESKTOP-EVN2V0D/,
  );
  // El prompt ya no deja al agente sin salida ni lo manda a buscar otra vinculación.
  const brief = equiposBrief(store);
  assert.match(brief, /use equipo_open: a window started with equipo_run is born where nobody sees it/);
  assert.match(brief, /never send the owner to look for another kind of connection/);
  assert.doesNotMatch(brief, /Nothing shows or drives their screen/);
});
