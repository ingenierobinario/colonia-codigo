// CLAUDE-CUENTA-1: el plan Pro o Max de Claude se conecta con el propio inicio de sesión de Claude Code
// (`claude auth login --claudeai`): Colonia lo arranca, enseña la página de Claude que imprime y, si Claude pide el
// código de la página, se lo pasa. Colonia nunca lee, copia ni guarda el token: lo guarda Claude Code (D-043, D-185).

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ClaudeAccountStatus } from "@colonia/protocol";
import { spawnable } from "../programs.ts";
import { forgetWhich, which } from "./detect.ts";
import { childEnv } from "./env.ts";

const run = promisify(execFile);
/** La dirección de inicio de sesión que Claude Code imprime («If the browser didn't open, visit: …»). */
const AUTH_URL = /https:\/\/\S+\/oauth\/authorize\?\S+/;
/** Un inicio de sesión que nadie termina se cierra solo. */
const LOGIN_TTL_MS = 10 * 60_000;

type Deps = {
  /** Dónde está `claude`; por defecto, el de la máquina del owner. */
  find?: () => Promise<string | undefined>;
  /** Tras conectar o desconectar: que se vuelva a mirar qué motores hay. */
  onChange?: () => void;
};

export type ClaudeLogin = ReturnType<typeof claudeLogin>;

export function claudeLogin(deps: Deps = {}) {
  const find = deps.find ?? (() => which("claude"));
  let child: ChildProcess | undefined;
  let pending: { url: string; expires_at: string } | undefined;
  let error: string | undefined;

  const exec = async (bin: string, args: string[]): Promise<string> => {
    const start = spawnable(bin, args);
    if (!start) throw new Error(`${bin} no se puede arrancar`);
    const { stdout } = await run(start.file, start.args, { timeout: 15_000, windowsHide: true, env: childEnv() });
    return stdout;
  };

  const stop = () => {
    child?.kill();
    child = undefined;
    pending = undefined;
  };

  async function status(): Promise<ClaudeAccountStatus> {
    const bin = await find();
    if (!bin) return { installed: false, connected: false, ...(error ? { error } : {}) };
    let a: { loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string } = {};
    try {
      a = JSON.parse(await exec(bin, ["auth", "status", "--json"]));
    } catch {}
    // Con clave de API Claude Code también dice loggedIn: aquí solo cuenta la cuenta de claude.ai.
    const connected = Boolean(a.loggedIn) && (!a.authMethod || a.authMethod === "claude.ai");
    if (connected && pending) stop();
    return {
      installed: true,
      connected,
      ...(connected && a.email ? { account: a.email } : {}),
      ...(connected && a.subscriptionType ? { plan: a.subscriptionType } : {}),
      ...(pending ? { pending } : {}),
      ...(error && !connected ? { error } : {}),
    };
  }

  /** Arranca el inicio de sesión y espera a tener la dirección que hay que abrir. */
  async function start(): Promise<ClaudeAccountStatus> {
    const bin = await find();
    if (!bin) return status();
    stop();
    error = undefined;
    const sp = spawnable(bin, ["auth", "login", "--claudeai"]);
    if (!sp) throw new Error(`${bin} no se puede arrancar`);
    // BROWSER vacío: el navegador lo abre el panel, que puede estar en otra máquina que el núcleo.
    const proc = spawn(sp.file, sp.args, { windowsHide: true, env: { ...childEnv(), BROWSER: "none" } });
    child = proc;
    const url = await new Promise<string | undefined>((resolve) => {
      let out = "";
      const read = (b: Buffer) => {
        out += b.toString();
        const m = AUTH_URL.exec(out);
        if (m) resolve(m[0]);
      };
      proc.stdout?.on("data", read);
      proc.stderr?.on("data", read);
      proc.on("error", (e) => {
        error = e.message;
        resolve(undefined);
      });
      proc.on("exit", (code) => {
        if (child === proc) {
          child = undefined;
          pending = undefined;
          if (code) error = out.trim().split("\n").pop() || `claude terminó con el código ${code}`;
          deps.onChange?.();
        }
        resolve(undefined);
      });
      setTimeout(() => resolve(undefined), 20_000);
    });
    if (url && child === proc) {
      pending = { url, expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString() };
      setTimeout(() => child === proc && stop(), LOGIN_TTL_MS).unref?.();
    } else if (!url && child === proc) {
      stop();
      error ??= "Claude Code no dio la página de inicio de sesión";
    }
    return status();
  }

  /** El código que la página de Claude muestra al terminar, cuando Claude Code lo pide. */
  async function code(text: string): Promise<ClaudeAccountStatus> {
    if (!child?.stdin) throw new Error("No hay ningún inicio de sesión de Claude en curso");
    child.stdin.write(`${text.trim()}\n`);
    // Claude Code canjea el código y termina: se espera un poco a que lo haga.
    const proc = child;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      setTimeout(resolve, 15_000);
    });
    return status();
  }

  async function disconnect(): Promise<ClaudeAccountStatus> {
    stop();
    error = undefined;
    const bin = await find();
    if (bin) {
      try {
        await exec(bin, ["auth", "logout"]);
      } catch {}
      deps.onChange?.();
    }
    return status();
  }

  /**
   * Sin Claude Code en la máquina: lo instala con el instalador oficial de Anthropic, sin ventanas, y vuelve a mirar.
   * Tarda un par de minutos; si falla, el panel enseña el enlace de descarga.
   */
  async function install(): Promise<ClaudeAccountStatus> {
    if (await find()) return status();
    error = undefined;
    const [file, args] =
      process.platform === "win32"
        ? [
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              "irm https://claude.ai/install.ps1 | iex",
            ],
          ]
        : ["/bin/sh", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]];
    try {
      await run(file, args, { timeout: 5 * 60_000, windowsHide: true, env: childEnv() });
    } catch (e) {
      error = `No se pudo instalar Claude Code: ${(e as Error).message.split("\n")[0]}`;
    }
    forgetWhich("claude");
    deps.onChange?.();
    return status();
  }

  return { status, start, code, disconnect, install, cancel: stop };
}
