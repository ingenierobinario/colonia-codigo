// Lo que un equipo sabe hacer cuando su dueño lo ha aprobado: ejecutar un comando, leer un archivo, subir otro.
// Es un proceso normal con los permisos del usuario del equipo, sin elevar nada. La terminal pty no se reutiliza:
// aquí hace falta código de salida y salida acotada, no una sesión interactiva.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Op, Result } from "./wire.ts";

const OUTPUT_MAX = 200_000;
const FILE_MAX = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_S = 120;

export type Run = (op: Extract<Op, { op: "run" }>) => Promise<Extract<Result, { exit_code: number | null }>>;

export const runCommand: Run = (op) =>
  new Promise((resolve) => {
    let out = "";
    let truncated = false;
    const child = spawn(op.command, {
      shell: true,
      windowsHide: true,
      ...(op.cwd ? { cwd: op.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (b: Buffer) => {
      if (out.length >= OUTPUT_MAX) {
        truncated = true;
        return;
      }
      out += b.toString("utf8");
      if (out.length > OUTPUT_MAX) {
        out = out.slice(0, OUTPUT_MAX);
        truncated = true;
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      out += "\n[Colonia] Tiempo agotado: el comando se detuvo.";
      child.kill();
    }, (op.timeout_s ?? DEFAULT_TIMEOUT_S) * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exit_code: null, output: `No se pudo ejecutar: ${e.message}`, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exit_code: code, output: out, truncated });
    });
  });

export function readFile(p: string): Result {
  const full = path.resolve(p);
  const size = fs.statSync(full).size;
  const fd = fs.openSync(full, "r");
  try {
    const buf = Buffer.alloc(Math.min(size, FILE_MAX));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return { content_base64: buf.toString("base64"), size, truncated: size > FILE_MAX };
  } finally {
    fs.closeSync(fd);
  }
}

export function writeFile(p: string, base64: string): Result {
  const data = Buffer.from(base64, "base64");
  if (data.length > FILE_MAX) throw new Error("el archivo es demasiado grande");
  const full = path.resolve(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return { written: data.length };
}
