// EQUIPOS-SIN-AGENTE-1 · Un equipo de la red al que se llega por SSH, sin instalar nada en él. Se usa el `ssh` del
// sistema (OpenSSH viene con Windows 10+, macOS y Linux). La contraseña o la clave viven en el almacén de secretos
// (cifrado) y solo se entregan a `ssh` en el momento: la contraseña por SSH_ASKPASS desde una variable de entorno del
// proceso hijo, la clave en un fichero temporal propio que se borra al terminar. Nunca en la línea de órdenes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Secrets } from "../secrets.ts";

export type SshTarget = {
  host: string;
  port: number;
  user: string;
  password?: string;
  key?: string;
};
export type SshOut = { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean };
export type SshExec = (t: SshTarget, command: string, timeoutMs: number) => Promise<SshOut>;
export type RemoteOs = "windows" | "linux" | "macos" | "other";

const OUTPUT_MAX = 200_000;
const FILE_MAX = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_S = 8;
const secretName = (id: string) => `equipos.ssh.${id}`;

/** El `ssh` del sistema. `home` guarda los known_hosts propios de Colonia (no toca los del usuario). */
export function systemSshExec(home: string): SshExec {
  return (t, command, timeoutMs) =>
    new Promise((resolve) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "colonia-ssh-"));
      const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
      const env: NodeJS.ProcessEnv = { ...process.env };
      const args = [
        "-p",
        String(t.port),
        "-o",
        `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        `UserKnownHostsFile=${path.join(home, "equipos_known_hosts")}`,
        "-o",
        "NumberOfPasswordPrompts=1",
      ];
      if (t.key) {
        const keyFile = path.join(tmp, "id");
        fs.writeFileSync(keyFile, t.key.endsWith("\n") ? t.key : `${t.key}\n`, { mode: 0o600 });
        args.push("-i", keyFile, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes");
      } else if (t.password) {
        // SSH_ASKPASS: un programa que imprime la contraseña. Se la lee de la variable del proceso, no de un fichero.
        const read = `process.stdout.write(process.env.COLONIA_SSH_PASS||"")`;
        const askpass = process.platform === "win32" ? path.join(tmp, "askpass.cmd") : path.join(tmp, "askpass.sh");
        fs.writeFileSync(
          askpass,
          process.platform === "win32"
            ? `@"${process.execPath}" -e "${read.replace(/"/g, '\\"')}"\r\n`
            : `#!/bin/sh\nexec "${process.execPath}" -e '${read}'\n`,
          { mode: 0o700 },
        );
        env.COLONIA_SSH_PASS = t.password;
        env.SSH_ASKPASS = askpass;
        env.SSH_ASKPASS_REQUIRE = "force";
        env.DISPLAY = env.DISPLAY || ":0";
        args.push("-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no");
      } else {
        args.push("-o", "BatchMode=yes");
      }
      args.push("-l", t.user, "--", t.host, command);
      const child = spawn("ssh", args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let size = 0;
      let err = "";
      let timedOut = false;
      child.stdout.on("data", (b: Buffer) => {
        if (size < FILE_MAX * 2) out.push(b);
        size += b.length;
      });
      child.stderr.on("data", (b: Buffer) => {
        if (err.length < 20_000) err += b.toString("utf8");
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        cleanup();
        resolve({ code: null, stdout: Buffer.alloc(0), stderr: `no se pudo abrir ssh: ${e.message}`, timedOut });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        cleanup();
        resolve({ code, stdout: Buffer.concat(out), stderr: err, timedOut });
      });
    });
}

/** Comillas simples de sh: lo de dentro no se interpreta. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** PowerShell con el script en base64 (UTF-16LE): ni cmd ni PowerShell interpretan nada de lo que va dentro. */
export const psEncoded = (script: string) =>
  `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function osFromProbe(text: string): RemoteOs {
  const t = text.toLowerCase();
  if (t.includes("windows")) return "windows";
  if (t.includes("darwin")) return "macos";
  if (t.includes("linux")) return "linux";
  return "other";
}

/** Por qué no entró, en palabras llanas. */
export function explainSshError(out: SshOut): string {
  const e = out.stderr.toLowerCase();
  if (out.timedOut || e.includes("timed out")) return "El equipo no responde. ¿Está encendido y en la misma red?";
  if (e.includes("permission denied")) return "El usuario o la contraseña no son correctos.";
  if (e.includes("connection refused")) return "Ese equipo no acepta conexiones de terminal (SSH).";
  if (e.includes("could not resolve") || e.includes("no such host")) return "No se encuentra un equipo con ese nombre.";
  if (e.includes("host key verification failed") || e.includes("remote host identification has changed"))
    return "La identidad de ese equipo ha cambiado desde la última vez. Por seguridad no se conecta.";
  if (e.includes("no se pudo abrir ssh")) return "Este ordenador no tiene el programa de terminal remota (OpenSSH).";
  return "No se pudo conectar con ese equipo.";
}

export function createSshEquipos(d: { secrets: Secrets; exec: SshExec }) {
  const load = (id: string): SshTarget | undefined => {
    const raw = d.secrets.resolve(`secret://${secretName(id)}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SshTarget;
    } catch {
      return undefined;
    }
  };
  const need = (id: string) => {
    const t = load(id);
    if (!t) throw new Error("faltan los datos de acceso de ese equipo: vuelve a conectarlo");
    return t;
  };
  const truncate = (b: Buffer) => {
    const text = b.toString("utf8");
    return { output: text.slice(0, OUTPUT_MAX), truncated: text.length > OUTPUT_MAX };
  };

  return {
    /** Prueba el acceso y averigua nombre y sistema. No guarda nada. */
    async probe(t: SshTarget): Promise<{ ok: true; hostname: string; os: RemoteOs } | { ok: false; error: string }> {
      const out = await d.exec(t, "hostname && (uname -s || ver)", 20_000);
      if (out.code !== 0) return { ok: false, error: explainSshError(out) };
      const [hostname = "", ...rest] = out.stdout.toString("utf8").trim().split(/\r?\n/);
      return { ok: true, hostname: hostname.trim(), os: osFromProbe(rest.join(" ")) };
    },
    save(id: string, t: SshTarget) {
      d.secrets.set(secretName(id), JSON.stringify(t));
    },
    forget(id: string) {
      d.secrets.set(secretName(id), null);
    },
    has: (id: string) => load(id) !== undefined,
    async run(id: string, os_: RemoteOs, command: string, cwd?: string, timeoutS = 120) {
      const t = need(id);
      const full = cwd
        ? os_ === "windows"
          ? `cd /d "${cwd.replace(/"/g, "")}" && ${command}`
          : `cd ${shQuote(cwd)} && ${command}`
        : command;
      const out = await d.exec(t, full, timeoutS * 1000);
      if (out.code === 255 && !out.stdout.length) throw new Error(explainSshError(out));
      const both = Buffer.concat([out.stdout, Buffer.from(out.stderr)]);
      const r = truncate(both);
      return {
        exit_code: out.timedOut ? null : out.code,
        output: out.timedOut ? `${r.output}\n[Colonia] Tiempo agotado: el comando se detuvo.` : r.output,
        truncated: r.truncated,
      };
    },
    async readFile(id: string, os_: RemoteOs, p: string) {
      const t = need(id);
      const cmd =
        os_ === "windows"
          ? psEncoded(
              `$f=Get-Item -LiteralPath ${psQuote(p)}; $s=$f.Length; $fs=[IO.File]::OpenRead($f.FullName); $b=New-Object byte[] ([Math]::Min($s,${FILE_MAX})); [void]$fs.Read($b,0,$b.Length); $fs.Close(); "$s"; [Convert]::ToBase64String($b)`,
            )
          : `wc -c < ${shQuote(p)} && head -c ${FILE_MAX} ${shQuote(p)} | base64`;
      const out = await d.exec(t, cmd, 60_000);
      if (out.code !== 0) throw new Error(out.code === 255 ? explainSshError(out) : "no se pudo leer ese archivo");
      const [first = "0", ...rest] = out.stdout.toString("utf8").split(/\r?\n/);
      const size = Number(first.trim()) || 0;
      const content_base64 = rest.join("").replace(/\s+/g, "");
      return { content_base64, size, truncated: size > FILE_MAX };
    },
    async listFiles(id: string, os_: RemoteOs, p: string) {
      const t = need(id);
      const cmd =
        os_ === "windows"
          ? psEncoded(
              `Get-ChildItem -Force -LiteralPath ${psQuote(p)} | Format-Table Mode,LastWriteTime,Length,Name -AutoSize | Out-String -Width 220`,
            )
          : `ls -lA -- ${shQuote(p)}`;
      const out = await d.exec(t, cmd, 30_000);
      if (out.code !== 0)
        throw new Error(out.code === 255 ? explainSshError(out) : out.stderr.trim() || "no se pudo listar esa carpeta");
      return truncate(out.stdout);
    },
  };
}
export type SshEquipos = ReturnType<typeof createSshEquipos>;
